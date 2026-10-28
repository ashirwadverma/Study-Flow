const fs = require("fs");

const { extractTextFromPDF } = require("../services/pdfExtractor");

const { analyzeSyllabusWithAI } = require("../services/llmService");

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

    return res.json({
      success: true,
      message: "Syllabus analyzed successfully.",
      filename: filename,
      data: structuredData,
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
