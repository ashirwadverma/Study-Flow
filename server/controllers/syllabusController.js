const fs = require("fs");
const { extractTextFromPDF } = require("../services/pdfExtractor");
const { analyzeSyllabusWithAI } = require("../services/llmService");
const { getSupabaseClient, createScopedClient, isConfigured } = require("../config/supabase");

/**
 * Extracts and verifies the authenticated Supabase user from the request headers.
 * Returns { user, client } if valid, or null if unauthenticated.
 */
async function getAuthenticatedUser(req) {
  try {
    if (!isConfigured) return null;

    let token = null;
    const authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
    if (authHeader && typeof authHeader === "string") {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      token = match ? match[1].trim() : authHeader.trim();
    } else if (req.headers && req.headers["x-auth-token"]) {
      token = String(req.headers["x-auth-token"]).trim();
    } else if (req.cookies && req.cookies["sb_access_token"]) {
      token = String(req.cookies["sb_access_token"]).trim();
    }

    if (!token) return null;

    const baseClient = getSupabaseClient();
    const { data, error } = await baseClient.auth.getUser(token);

    if (error || !data || !data.user) {
      console.warn("Syllabus upload auth token invalid or expired:", error ? error.message : "No user");
      return null;
    }

    return {
      user: data.user,
      client: createScopedClient(token),
    };
  } catch (err) {
    console.warn("Could not verify auth token in syllabus upload:", err.message);
    return null;
  }
}

async function analyzeSyllabus(req, res) {
  let filePath = null;

  try {
    let syllabusText = "";
    let filename = "syllabus.txt";
    let fileBuffer = null;
    let mimeType = null;

    if (req.file) {
      filePath = req.file.path;
      filename = req.file.originalname;
      mimeType = req.file.mimetype;
      fileBuffer = fs.readFileSync(filePath);
      console.log("File received:", filename, "Type:", mimeType, "Size:", fileBuffer.length, "bytes");

      if (mimeType === "application/pdf") {
        try {
          const extracted = await extractTextFromPDF(filePath);
          if (extracted && extracted.trim().length >= 15) {
            syllabusText = extracted;
            console.log("Extracted text from PDF length:", syllabusText.length);
          } else {
            console.log("PDF appears to be scanned or image-based; using Gemini multimodal analysis.");
          }
        } catch (pdfErr) {
          console.warn("PDF text parse note:", pdfErr.message);
        }
      } else if (mimeType === "text/plain") {
        syllabusText = fileBuffer.toString("utf-8");
      } else if (mimeType && mimeType.startsWith("image/")) {
        console.log("Image syllabus uploaded; using Gemini vision analysis.");
      }
    } else if (req.body && req.body.syllabusText) {
      syllabusText = req.body.syllabusText;
      filename = req.body.title || "Pasted Syllabus";
    } else {
      return res.status(400).json({
        success: false,
        message: "Please upload a syllabus file (PDF, Image, or TXT) or paste syllabus text.",
      });
    }

    // If text was pasted/provided but too short and no file buffer was uploaded
    if (!fileBuffer && (!syllabusText || syllabusText.trim().length < 15)) {
      return res.status(400).json({
        success: false,
        message: "Could not extract sufficient text from the syllabus. Please provide a clear document or paste the syllabus text.",
      });
    }

    const aiResult = await analyzeSyllabusWithAI({
      syllabusText,
      fileBuffer,
      mimeType,
      filename,
    });

    let structuredData;

    try {
      let cleaned = (aiResult || "").trim();
      // Strip markdown code fences if present
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }
      structuredData = JSON.parse(cleaned);
    } catch (parseError) {
      console.error("AI returned invalid JSON:", aiResult);

      return res.status(500).json({
        success: false,
        message: "The AI returned an invalid syllabus structure. Please try again.",
      });
    }

    // ─── PHASE 4: CONNECT SYLLABUS UPLOAD TO SUPABASE ─────────
    // Extract subject details from Gemini AI response
    let extractedName = (structuredData.subjectName || "").trim();
    if (!extractedName && structuredData.subjects && structuredData.subjects.length) {
      extractedName = (structuredData.subjects[0].name || "").trim();
    }
    if (!extractedName && filename) {
      extractedName = filename.replace(/\.(pdf|txt|png|jpe?g|webp)$/i, "").replace(/[-_]/g, " ").trim();
    }
    if (!extractedName) {
      extractedName = "Course Syllabus";
    }
    if (extractedName.length > 255) {
      extractedName = extractedName.slice(0, 255);
    }

    let extractedCode = structuredData.courseCode || null;
    if (!extractedCode && structuredData.subjects && structuredData.subjects[0]) {
      extractedCode = structuredData.subjects[0].code || null;
    }
    if (extractedCode) {
      extractedCode = String(extractedCode).trim();
      if (extractedCode.length > 50) extractedCode = extractedCode.slice(0, 50);
      if (extractedCode.length === 0) extractedCode = null;
    }

    // Attempt to persist the extracted subject to Supabase for the authenticated student
    let savedSubject = null;
    let savedSubjectStatus = "unauthenticated";
    let dbSaveError = null;

    const authContext = await getAuthenticatedUser(req);

    if (authContext && authContext.user) {
      try {
        const scopedClient = authContext.client;
        const userId = authContext.user.id;

        // Check for existing subject for this student to avoid duplicates
        let { data: existing, error: searchErr } = await scopedClient
          .from("Subjects")
          .select("*")
          .eq("user_id", userId)
          .ilike("subject_name", extractedName)
          .limit(1);

        // Fallback to lowercase 'subjects' if 'Subjects' table not found
        if (searchErr && searchErr.code === "PGRST205") {
          const fallbackSearch = await scopedClient
            .from("subjects")
            .select("*")
            .eq("user_id", userId)
            .ilike("name", extractedName)
            .limit(1);
          if (!fallbackSearch.error) {
            existing = fallbackSearch.data;
            searchErr = null;
          }
        }

        if (existing && existing.length > 0) {
          savedSubject = existing[0];
          savedSubjectStatus = "existing";
          console.log(`[Supabase] Subject '${extractedName}' already exists (ID: ${savedSubject.id}) for student ${userId}. Reusing existing record.`);
        } else {
          // Subject does not exist: insert it with initial progress = 0
          const insertRecord = {
            id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
            user_id: userId,
            subject_name: extractedName,
            subject_code: extractedCode,
            progress: 0,
          };

          let { data: inserted, error: insertErr } = await scopedClient
            .from("Subjects")
            .insert([insertRecord])
            .select()
            .single();

          // Fallback to lowercase 'subjects' table if necessary
          if (insertErr && insertErr.code === "PGRST205") {
            const fallbackInsert = {
              user_id: userId,
              name: extractedName,
              code: extractedCode,
            };
            const fallbackRes = await scopedClient
              .from("subjects")
              .insert([fallbackInsert])
              .select()
              .single();
            if (!fallbackRes.error) {
              inserted = fallbackRes.data;
              insertErr = null;
            }
          }

          if (insertErr) {
            console.error("[Supabase] Subject insert failed:", insertErr.message || insertErr);
            savedSubjectStatus = "error";
            dbSaveError = insertErr.message || "Failed to persist subject to Supabase.";
          } else {
            savedSubject = inserted;
            savedSubjectStatus = "created";
            console.log(`[Supabase] Inserted subject '${extractedName}' with ID ${savedSubject.id} for student ${userId}.`);
          }
        }
      } catch (err) {
        console.error("[Supabase] Unexpected error during syllabus subject persistence:", err.message);
        savedSubjectStatus = "error";
        dbSaveError = err.message;
      }
    } else {
      console.log("[Supabase] Anonymous or unauthenticated upload: subject will not be linked to Supabase user.");
    }

    return res.json({
      success: true,
      message: "Syllabus analyzed successfully.",
      filename: filename,
      data: structuredData,
      savedSubject: savedSubject ? {
        id: savedSubject.id,
        user_id: savedSubject.user_id,
        subject_name: savedSubject.subject_name || savedSubject.name,
        subject_code: savedSubject.subject_code || savedSubject.code,
        progress: savedSubject.progress !== undefined ? Number(savedSubject.progress) : 0,
        created_at: savedSubject.created_at,
      } : null,
      savedSubjectStatus: savedSubjectStatus,
      dbSaveError: dbSaveError || undefined,
    });
  } catch (error) {
    console.error("analyzeSyllabus error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Something went wrong while analyzing the syllabus.",
      error: error.message,
    });
  } finally {
    // Clean up temporary uploaded file
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr) {
        console.warn("Could not remove temp file:", unlinkErr.message);
      }
    }
  }
}

module.exports = {
  analyzeSyllabus,
};
