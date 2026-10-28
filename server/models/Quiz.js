const mongoose = require("mongoose");

const mcqOptionSchema = new mongoose.Schema({
  id: { type: String, required: true }, // "A", "B", "C", "D"
  text: { type: String, required: true }
}, { _id: false });

const mcqQuestionSchema = new mongoose.Schema({
  id: { type: String, required: true }, // "q1" ... "q10"
  questionText: { type: String, required: true },
  options: {
    type: [mcqOptionSchema],
    validate: {
      validator: function(opts) {
        return Array.isArray(opts) && opts.length === 4;
      },
      message: "Each question must have exactly 4 options."
    }
  },
  correctOptionId: { type: String, required: true }, // "A", "B", "C", or "D"
  explanation: { type: String, required: true },
  topic: { type: String, required: true },
  difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
  provenance: { type: String, enum: ["syllabus", "pyq"], default: "syllabus" },
  pyqReference: { type: String, default: null } // e.g. "Year 2024 Paper, Q3 (5 marks)"
}, { _id: false });

const quizSchema = new mongoose.Schema({
  quizId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  subjectId: { type: String, required: true, index: true },
  topicId: { type: String, required: true, index: true },
  topicName: { type: String, required: true },
  version: { type: Number, default: 1 },
  questions: {
    type: [mcqQuestionSchema],
    validate: {
      validator: function(qs) {
        return Array.isArray(qs) && qs.length === 10;
      },
      message: "An assessment must contain exactly 10 questions."
    }
  },
  sourceContextHash: { type: String, default: "" },
  isValidated: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

quizSchema.index({ userId: 1, topicId: 1, version: -1 });

const Quiz = mongoose.model("Quiz", quizSchema);

module.exports = Quiz;
