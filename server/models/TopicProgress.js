const mongoose = require("mongoose");

const topicProgressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  subjectId: { type: String, required: true, index: true },
  topicId: { type: String, required: true, index: true },
  topicName: { type: String, required: true },
  status: {
    type: String,
    enum: ["not_started", "in_progress", "assessment_required", "needs_revision", "completed"],
    default: "not_started",
    index: true
  },
  qualifyingAttemptId: { type: String, default: null },
  bestScore: { type: Number, default: 0 },
  latestScore: { type: Number, default: 0 },
  totalAttempts: { type: Number, default: 0 },
  completedAt: { type: Date, default: null },
  pyqPracticeStatus: {
    type: String,
    enum: ["not_started", "in_progress", "completed"],
    default: "not_started"
  },
  lastAttemptDate: { type: Date, default: null }
}, {
  timestamps: true
});

topicProgressSchema.index({ userId: 1, topicId: 1 }, { unique: true });
topicProgressSchema.index({ userId: 1, subjectId: 1 });

const TopicProgress = mongoose.model("TopicProgress", topicProgressSchema);

module.exports = TopicProgress;
