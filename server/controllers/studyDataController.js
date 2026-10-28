const db = require("../services/dbAdapter");

// ─── GET /api/user/data (Protected) ─────────────────────────
async function getUserStudyData(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const data = await db.getUserStudyData(userId);

    return res.status(200).json({
      success: true,
      data: {
        subjects: data.subjects || [],
        sessions: data.sessions || [],
        notes: data.notes || {},
        activity: data.activity || [],
        settings: data.settings || {},
      },
    });
  } catch (error) {
    console.error("getUserStudyData error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load user study data.",
    });
  }
}

// ─── POST /api/user/data (Protected) ────────────────────────
async function saveUserStudyData(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { subjects, sessions, notes, activity, settings } = req.body || {};

    const updateFields = {};
    if (Array.isArray(subjects)) updateFields.subjects = subjects;
    if (Array.isArray(sessions)) {
      // FR-06: Automatic Topic Completion Enforcement
      // The student must NOT be able to mark a topic completed through frontend requests.
      // Every session claiming status "done" or "completed" must have a qualifying assessment attempt.
      const sanitizedSessions = await Promise.all(
        sessions.map(async (sess) => {
          if (!sess) return sess;
          const status = String(sess.status || "").toLowerCase();
          if (status === "done" || status === "completed") {
            const isVerifiedCompleted = await db.isTopicCompleted(userId, sess.id);
            if (!isVerifiedCompleted) {
              // Revert unauthorized completion
              const progress = await db.getTopicProgress(userId, sess.id);
              return {
                ...sess,
                status: progress && progress.status === "needs_revision" ? "needs_revision" : "pending",
                completedScore: undefined,
                completedAt: undefined,
              };
            }
          }
          return sess;
        })
      );
      updateFields.sessions = sanitizedSessions;
    }
    if (notes !== undefined) {
      if (typeof notes === "object" && notes !== null) {
        updateFields.notes = notes;
      } else if (typeof notes === "string") {
        updateFields.notes = { content: notes };
      }
    }
    if (Array.isArray(activity)) updateFields.activity = activity;
    if (settings && typeof settings === "object") updateFields.settings = settings;

    const data = await db.saveUserStudyData(userId, updateFields);

    return res.status(200).json({
      success: true,
      message: "Study data saved successfully.",
      data: {
        subjects: data.subjects || [],
        sessions: data.sessions || [],
        notes: data.notes || {},
        activity: data.activity || [],
        settings: data.settings || {},
      },
    });
  } catch (error) {
    console.error("saveUserStudyData error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not save user study data.",
    });
  }
}

module.exports = {
  getUserStudyData,
  saveUserStudyData,
};
