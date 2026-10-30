const express = require("express");
const { requireSupabaseAuth } = require("../middleware/supabaseAuth");

const router = express.Router();

// UUID v4 format validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generates a unique 64-bit integer ID that fits safely within PostgreSQL BIGINT.
 * Prevents "null value in column id violates not-null constraint" when table lacks an identity sequence.
 */
function generateBigIntId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

/**
 * Standardize Supabase/PostgREST error responses without leaking internal credentials.
 */
function handleSupabaseError(res, error, defaultMessage = "Database operation failed.") {
  if (!error) {
    return res.status(500).json({
      success: false,
      message: defaultMessage,
    });
  }

  // Schema cache error: Table does not exist in Supabase
  if (error.code === "PGRST205") {
    return res.status(503).json({
      success: false,
      message: "Database table 'Subjects' does not exist in Supabase schema cache.",
      code: "TABLE_NOT_FOUND",
      details: error.hint || error.message,
    });
  }

  // PostgreSQL permission denied / RLS violation
  if (error.code === "42501") {
    return res.status(403).json({
      success: false,
      message: "Access denied by database Row Level Security (RLS) policy. Ensure the RLS policies are applied.",
      code: "RLS_PERMISSION_DENIED",
    });
  }

  // Unique constraint violation
  if (error.code === "23505") {
    return res.status(409).json({
      success: false,
      message: "A subject with this identifier or name already exists.",
      code: "DUPLICATE_RECORD",
    });
  }

  // General database error
  console.error("Supabase Database Error:", error.message || error);
  return res.status(500).json({
    success: false,
    message: error.message || defaultMessage,
    code: error.code || "DATABASE_ERROR",
  });
}

/**
 * Normalizes subject object to support both schema formats
 */
function formatSubjectResponse(sub) {
  if (!sub) return sub;
  return {
    id: sub.id,
    user_id: sub.user_id,
    subject_name: sub.subject_name || sub.name || "",
    subject_code: sub.subject_code || sub.code || "",
    name: sub.subject_name || sub.name || "",
    code: sub.subject_code || sub.code || "",
    progress: sub.progress !== undefined ? Number(sub.progress) : 0,
    created_at: sub.created_at,
  };
}

/**
 * GET /api/subjects
 * Retrieve all subjects belonging to the authenticated user from Supabase.
 * Respects PostgreSQL Row Level Security (RLS).
 */
router.get("/", requireSupabaseAuth, async (req, res) => {
  try {
    // Query "Subjects" table with user-scoped client
    let { data, error } = await req.supabaseClient
      .from("Subjects")
      .select("*")
      .order("created_at", { ascending: false });

    // Fallback to lowercase if "Subjects" not found
    if (error && error.code === "PGRST205") {
      const fallback = await req.supabaseClient
        .from("subjects")
        .select("*")
        .order("created_at", { ascending: false });
      if (!fallback.error) {
        data = fallback.data;
        error = null;
      }
    }

    if (error) {
      return handleSupabaseError(res, error, "Failed to retrieve subjects.");
    }

    const formatted = Array.isArray(data) ? data.map(formatSubjectResponse) : [];

    return res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (err) {
    console.error("GET /api/subjects unexpected error:", err.message);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while fetching subjects.",
    });
  }
});

/**
 * POST /api/subjects
 * Insert a new subject for the authenticated user into Supabase.
 * Enforces user_id matching the verified Supabase Auth JWT.
 */
router.post("/", requireSupabaseAuth, async (req, res) => {
  try {
    // ─── 1. SUPPORT BATCH ARRAY PAYLOAD ────────────────────────
    if (Array.isArray(req.body.subjects) && req.body.subjects.length > 0) {
      const processed = [];
      for (const item of req.body.subjects) {
        const itemSubjectName = (item.subject_name || item.name || "").trim();
        if (!itemSubjectName) continue;

        let itemCode = item.subject_code || item.code || null;
        if (itemCode) {
          itemCode = String(itemCode).trim().slice(0, 50);
          if (itemCode.length === 0) itemCode = null;
        }

        let itemProgress = 0;
        if (item.progress !== undefined && item.progress !== null) {
          const parsedProg = Number(item.progress);
          if (!isNaN(parsedProg) && parsedProg >= 0 && parsedProg <= 100) {
            itemProgress = parsedProg;
          }
        }

        // Deduplication check
        let { data: existingItem } = await req.supabaseClient
          .from("Subjects")
          .select("*")
          .eq("user_id", req.supabaseUser.id)
          .ilike("subject_name", itemSubjectName)
          .limit(1);

        if (existingItem && existingItem.length > 0) {
          processed.push(formatSubjectResponse(existingItem[0]));
        } else {
          let { data: insertedItem, error: insErr } = await req.supabaseClient
            .from("Subjects")
            .insert([{
              id: generateBigIntId(),
              user_id: req.supabaseUser.id,
              subject_name: itemSubjectName,
              subject_code: itemCode,
              progress: itemProgress,
            }])
            .select()
            .single();

          if (!insErr && insertedItem) {
            processed.push(formatSubjectResponse(insertedItem));
          }
        }
      }

      return res.status(201).json({
        success: true,
        message: `Processed ${processed.length} subject(s) successfully.`,
        count: processed.length,
        data: processed.length === 1 ? processed[0] : processed,
      });
    }

    // ─── 2. SINGLE SUBJECT PAYLOAD ─────────────────────────────
    const subjectName = (req.body.subject_name || req.body.name || "").trim();
    const subjectCode = req.body.subject_code || req.body.code || null;
    const rawProgress = req.body.progress;

    // Validate required fields
    if (!subjectName) {
      return res.status(400).json({
        success: false,
        message: "Subject name is required and must be a non-empty string.",
      });
    }

    if (subjectName.length > 255) {
      return res.status(400).json({
        success: false,
        message: "Subject name cannot exceed 255 characters.",
      });
    }

    // Validate optional fields
    let cleanCode = null;
    if (subjectCode !== undefined && subjectCode !== null) {
      cleanCode = String(subjectCode).trim();
      if (cleanCode.length > 50) {
        return res.status(400).json({
          success: false,
          message: "Subject code cannot exceed 50 characters.",
        });
      }
      if (cleanCode.length === 0) cleanCode = null;
    }

    let cleanProgress = 0;
    if (rawProgress !== undefined && rawProgress !== null) {
      const parsed = Number(rawProgress);
      if (isNaN(parsed) || parsed < 0 || parsed > 100) {
        return res.status(400).json({
          success: false,
          message: "Progress must be a number between 0 and 100.",
        });
      }
      cleanProgress = parsed;
    }

    // Deduplication check: check if subject already exists for this authenticated student
    let { data: existing, error: searchError } = await req.supabaseClient
      .from("Subjects")
      .select("*")
      .eq("user_id", req.supabaseUser.id)
      .ilike("subject_name", subjectName)
      .limit(1);

    if (searchError && searchError.code === "PGRST205") {
      const fbSearch = await req.supabaseClient
        .from("subjects")
        .select("*")
        .eq("user_id", req.supabaseUser.id)
        .ilike("name", subjectName)
        .limit(1);
      if (!fbSearch.error) {
        existing = fbSearch.data;
      }
    }

    if (existing && existing.length > 0) {
      return res.status(200).json({
        success: true,
        alreadyExists: true,
        message: `Subject '${subjectName}' already exists. Reusing existing record.`,
        data: formatSubjectResponse(existing[0]),
      });
    }

    // Always enforce the authenticated user's ID to prevent cross-user spoofing
    const newSubject = {
      id: generateBigIntId(),
      user_id: req.supabaseUser.id,
      subject_name: subjectName,
      subject_code: cleanCode,
      progress: cleanProgress,
    };

    let { data, error } = await req.supabaseClient
      .from("Subjects")
      .insert([newSubject])
      .select()
      .single();

    // Fallback to lowercase if "Subjects" not found
    if (error && error.code === "PGRST205") {
      const fallbackInsert = {
        user_id: req.supabaseUser.id,
        name: subjectName,
        code: cleanCode,
      };
      const fallback = await req.supabaseClient
        .from("subjects")
        .insert([fallbackInsert])
        .select()
        .single();
      if (!fallback.error) {
        data = fallback.data;
        error = null;
      }
    }

    if (error) {
      return handleSupabaseError(res, error, "Failed to create subject.");
    }

    return res.status(201).json({
      success: true,
      message: "Subject created successfully.",
      data: formatSubjectResponse(data),
    });
  } catch (err) {
    console.error("POST /api/subjects unexpected error:", err.message);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while creating the subject.",
    });
  }
});

/**
 * PATCH /api/subjects/:id (and PUT /api/subjects/:id)
 * Update an existing subject's progress, name, or code for the authenticated user.
 * Row Level Security & user_id filter prevent updating other users' records.
 */
async function updateSubjectHandler(req, res) {
  try {
    const rawId = req.params.id ? String(req.params.id).trim() : "";

    // Validate ID parameter (accepts numeric bigint or UUID)
    const isNumericId = /^\d+$/.test(rawId);
    const isUuidId = UUID_REGEX.test(rawId);

    if (!rawId || (!isNumericId && !isUuidId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subject ID. An ID (numeric or UUID) is required.",
      });
    }

    const queryId = isNumericId ? Number(rawId) : rawId;

    const updatePayload = {};
    const fallbackPayload = {};

    // Validate progress
    if (req.body.progress !== undefined) {
      const parsed = Number(req.body.progress);
      if (isNaN(parsed) || parsed < 0 || parsed > 100) {
        return res.status(400).json({
          success: false,
          message: "Progress must be a number between 0 and 100.",
        });
      }
      updatePayload.progress = parsed;
      fallbackPayload.progress = parsed;
    }

    // Validate subject name
    const rawName = req.body.subject_name || req.body.name;
    if (rawName !== undefined) {
      const cleanName = String(rawName).trim();
      if (!cleanName) {
        return res.status(400).json({
          success: false,
          message: "Subject name cannot be empty.",
        });
      }
      if (cleanName.length > 255) {
        return res.status(400).json({
          success: false,
          message: "Subject name cannot exceed 255 characters.",
        });
      }
      updatePayload.subject_name = cleanName;
      fallbackPayload.name = cleanName;
    }

    // Validate subject code
    const rawCode = req.body.subject_code || req.body.code;
    if (rawCode !== undefined) {
      let cleanCode = rawCode !== null ? String(rawCode).trim() : null;
      if (cleanCode && cleanCode.length > 50) {
        return res.status(400).json({
          success: false,
          message: "Subject code cannot exceed 50 characters.",
        });
      }
      if (cleanCode === "") cleanCode = null;
      updatePayload.subject_code = cleanCode;
      fallbackPayload.code = cleanCode;
    }

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one field to update (progress, subject_name, or subject_code) must be provided.",
      });
    }

    // Perform update with user-scoped client and explicit user_id filter
    let { data, error } = await req.supabaseClient
      .from("Subjects")
      .update(updatePayload)
      .eq("id", queryId)
      .eq("user_id", req.supabaseUser.id)
      .select();

    // Fallback to lowercase if "Subjects" not found
    if (error && error.code === "PGRST205") {
      const fallback = await req.supabaseClient
        .from("subjects")
        .update(fallbackPayload)
        .eq("id", queryId)
        .eq("user_id", req.supabaseUser.id)
        .select();
      if (!fallback.error) {
        data = fallback.data;
        error = null;
      }
    }

    if (error) {
      return handleSupabaseError(res, error, "Failed to update subject.");
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subject not found or you do not have permission to update it.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Subject updated successfully.",
      data: formatSubjectResponse(data[0]),
    });
  } catch (err) {
    console.error("PATCH /api/subjects/:id unexpected error:", err.message);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while updating the subject.",
    });
  }
}

router.patch("/:id", requireSupabaseAuth, updateSubjectHandler);
router.put("/:id", requireSupabaseAuth, updateSubjectHandler);

/**
 * DELETE /api/subjects/:id
 * Delete a subject by ID for the authenticated user.
 * Row Level Security & user_id filter prevent modifying other users' records.
 */
router.delete("/:id", requireSupabaseAuth, async (req, res) => {
  try {
    const rawId = req.params.id ? String(req.params.id).trim() : "";

    // Validate ID parameter (accepts numeric bigint or UUID)
    const isNumericId = /^\d+$/.test(rawId);
    const isUuidId = UUID_REGEX.test(rawId);

    if (!rawId || (!isNumericId && !isUuidId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subject ID. An ID (numeric or UUID) is required.",
      });
    }

    const queryId = isNumericId ? Number(rawId) : rawId;

    // Perform deletion with explicit user_id filter in addition to RLS
    let { data, error } = await req.supabaseClient
      .from("Subjects")
      .delete()
      .eq("id", queryId)
      .eq("user_id", req.supabaseUser.id)
      .select();

    // Fallback to lowercase if "Subjects" not found
    if (error && error.code === "PGRST205") {
      const fallback = await req.supabaseClient
        .from("subjects")
        .delete()
        .eq("id", queryId)
        .eq("user_id", req.supabaseUser.id)
        .select();
      if (!fallback.error) {
        data = fallback.data;
        error = null;
      }
    }

    if (error) {
      return handleSupabaseError(res, error, "Failed to delete subject.");
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subject not found or you do not have permission to delete it.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Subject deleted successfully.",
      data: formatSubjectResponse(data[0]),
    });
  } catch (err) {
    console.error("DELETE /api/subjects/:id unexpected error:", err.message);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while deleting the subject.",
    });
  }
});

module.exports = router;
