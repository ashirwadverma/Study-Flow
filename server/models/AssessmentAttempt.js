const mongoose = require("mongoose");

const assessmentAttemptSchema = new mongoose.Schema({
  attemptId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  topicId: { type: String, required: true, index: true },
  subjectId: { type: String, required: true, index: true },
  quizId: { type: String, required: true, index: true },
  quizVersion: { type: Number, default: 1 },
  answers: { type: Map, of: String, default: {} }, // questionId -> selectedOptionId
  score: { type: Number, required: true }, // 0 to 10
  totalQuestions: { type: Number, default: 10 },
  percentage: { type: Number, required: true }, // 0 to 100
  passed: { type: Boolean, required: true }, // score >= 8
  weakConcepts: [{ type: String }],
  questionBreakdown: [{
    questionId: String,
    questionText: String,
    selectedOptionId: String,
    correctOptionId: String,
    isCorrect: Boolean,
    explanation: String,
    difficulty: String,
    provenance: String,
    pyqReference: String
  }],
  startedAt: { type: Date, default: Date.now },
  submittedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

assessmentAttemptSchema.index({ userId: 1, topicId: 1, submittedAt: -1 });

const AssessmentAttempt = mongoose.model("AssessmentAttempt", assessmentAttemptSchema);

module.exports = AssessmentAttempt;
