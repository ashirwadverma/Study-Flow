const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  getAssessment,
  submitAttempt,
  getAttempts,
  getTopicProgress,
  getTopicPYQs,
  recordPYQPractice,
  updateNotificationPreferences,
  getNotifications,
} = require("../controllers/assessmentController");

const router = express.Router();

// Topic Assessment and Progress Endpoints (All Protected)
router.get("/:topicId/assessment", requireAuth, getAssessment);
router.post("/:topicId/assessment/attempts", requireAuth, submitAttempt);
router.get("/:topicId/assessment/attempts", requireAuth, getAttempts);
router.get("/:topicId/progress", requireAuth, getTopicProgress);
router.get("/:topicId/pyqs", requireAuth, getTopicPYQs);
router.post("/:topicId/pyqs/practice", requireAuth, recordPYQPractice);

module.exports = {
  topicRouter: router,
  updateNotificationPreferences,
  getNotifications,
  recordPYQPractice,
};
