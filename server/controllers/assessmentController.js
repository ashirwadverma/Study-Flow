const assessmentService = require("../services/assessmentService");
const db = require("../services/dbAdapter");

/**
 * GET /api/topics/:topicId/assessment
 * Retrieves a valid 10-question assessment (without answer key)
 */
async function getAssessment(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { topicId } = req.params;
    const forceRegenerate = req.query.regenerate === "true";

    if (!topicId || !topicId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Topic ID is required.",
      });
    }

    const assessment = await assessmentService.getOrGenerateAssessment({
      userId,
      topicId: topicId.trim(),
      forceRegenerate,
    });

    return res.status(200).json({
      success: true,
      data: assessment,
    });
  } catch (err) {
    console.error("getAssessment controller error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to generate assessment. Please try again.",
    });
  }
}

/**
 * POST /api/topics/:topicId/assessment/attempts
 * Submits student's answers, calculates score server-side, applies completion rule
 */
async function submitAttempt(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { topicId } = req.params;
    const { quizId, answers, startedAt } = req.body || {};

    if (!topicId || !topicId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Topic ID is required.",
      });
    }

    if (!answers || typeof answers !== "object") {
      return res.status(400).json({
        success: false,
        message: "Assessment answers are required.",
      });
    }

    const result = await assessmentService.submitAssessmentAttempt({
      userId,
      topicId: topicId.trim(),
      quizId,
      answers,
      startedAt,
    });

    return res.status(200).json({
      success: true,
      message: result.passed
        ? "Congratulations! You passed the assessment and completed the topic."
        : "You need revision. Review the explanations and retake the assessment.",
      data: result,
    });
  } catch (err) {
    console.error("submitAttempt controller error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to submit assessment attempt.",
    });
  }
}

/**
 * GET /api/topics/:topicId/assessment/attempts
 * Retrieves user attempt history for this topic
 */
async function getAttempts(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { topicId } = req.params;

    if (!topicId || !topicId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Topic ID is required.",
      });
    }

    const history = await assessmentService.getAttemptHistory({
      userId,
      topicId: topicId.trim(),
    });

    return res.status(200).json({
      success: true,
      data: history,
    });
  } catch (err) {
    console.error("getAttempts controller error:", err);
    return res.status(500).json({
      success: false,
      message: "Could not retrieve assessment attempts.",
    });
  }
}

/**
 * GET /api/topics/:topicId/progress
 * Retrieves authoritative topic status and progress
 */
async function getTopicProgress(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { topicId } = req.params;

    if (!topicId || !topicId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Topic ID is required.",
      });
    }

    const progress = await assessmentService.getAuthoritativeTopicProgress({
      userId,
      topicId: topicId.trim(),
    });

    return res.status(200).json({
      success: true,
      data: progress,
    });
  } catch (err) {
    console.error("getTopicProgress controller error:", err);
    return res.status(500).json({
      success: false,
      message: "Could not retrieve topic progress.",
    });
  }
}

/**
 * GET /api/topics/:topicId/pyqs
 * Retrieves verified mapped PYQs for this topic
 */
async function getTopicPYQs(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { topicId } = req.params;

    if (!topicId || !topicId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Topic ID is required.",
      });
    }

    const pyqs = await assessmentService.getTopicVerifiedPYQs({
      userId,
      topicId: topicId.trim(),
    });

    return res.status(200).json({
      success: true,
      data: pyqs,
    });
  } catch (err) {
    console.error("getTopicPYQs controller error:", err);
    return res.status(500).json({
      success: false,
      message: "Could not load PYQs for this topic.",
    });
  }
}

/**
 * POST /api/topics/:topicId/pyqs/practice
 * Records practice progress for previous-year questions
 */
async function recordPYQPractice(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { topicId } = req.params;
    const { status } = req.body || {};

    if (!topicId || !topicId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Topic ID is required.",
      });
    }

    const result = await assessmentService.recordPYQPracticeProgress({
      userId,
      topicId: topicId.trim(),
      status,
    });

    return res.status(200).json({
      success: true,
      message: "PYQ practice progress updated.",
      data: result,
    });
  } catch (err) {
    console.error("recordPYQPractice controller error:", err);
    return res.status(500).json({
      success: false,
      message: "Could not record PYQ practice progress.",
    });
  }
}

/**
 * PATCH /api/settings/notifications
 * Updates user notification preference
 */
async function updateNotificationPreferences(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { achievementEmails } = req.body || {};

    const updated = await db.updateUserNotificationPreferences(userId, {
      achievementEmails: achievementEmails !== undefined ? !!achievementEmails : true,
    });

    return res.status(200).json({
      success: true,
      message: "Notification preferences updated.",
      data: updated,
    });
  } catch (err) {
    console.error("updateNotificationPreferences controller error:", err);
    return res.status(500).json({
      success: false,
      message: "Could not update notification preferences.",
    });
  }
}

/**
 * GET /api/notifications
 * Retrieves user's notification event history
 */
async function getNotifications(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const notifications = await db.getUserNotifications(userId);
    const preferences = await db.getUserNotificationPreferences(userId);

    return res.status(200).json({
      success: true,
      data: {
        preferences,
        history: notifications,
      },
    });
  } catch (err) {
    console.error("getNotifications controller error:", err);
    return res.status(500).json({
      success: false,
      message: "Could not retrieve notifications.",
    });
  }
}

module.exports = {
  getAssessment,
  submitAttempt,
  getAttempts,
  getTopicProgress,
  getTopicPYQs,
  recordPYQPractice,
  updateNotificationPreferences,
  getNotifications,
};
