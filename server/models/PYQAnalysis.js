const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  paperId: { type: String, required: true },
  paperYear: { type: String, default: "Unknown" },
  paperName: { type: String, default: "" },
  questionNumber: { type: String, default: "" },
  questionText: { type: String, required: true },
  marks: { type: Number, default: null },
  detectedUnit: { type: String, default: null },
  matchedTopic: { type: String, required: true },
  secondaryTopics: [{ type: String }],
  isExplicitSyllabusMatch: { type: Boolean, default: false },
  isAiInferred: { type: Boolean, default: true },
  confidence: { type: String, enum: ["high", "medium", "low"], default: "medium" },
  isUserCorrected: { type: Boolean, default: false },
  userNotes: { type: String, default: "" }
});

const paperMetadataSchema = new mongoose.Schema({
  id: { type: String, required: true },
  fileName: { type: String, required: true },
  year: { type: String, required: true },
  fileSize: { type: Number, default: 0 },
  pageCount: { type: Number, default: 1 },
  isScannedPdf: { type: Boolean, default: false },
  extractedQuestionsCount: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now }
});

const topicPrioritySchema = new mongoose.Schema({
  topicName: { type: String, required: true },
  unit: { type: String, default: "General" },
  priorityScore: { type: Number, required: true }, // 0 to 100
  priorityLevel: { type: String, enum: ["High", "Medium", "Low"], required: true },
  paperCount: { type: Number, default: 0 }, // distinct papers
  totalPaperCount: { type: Number, default: 0 },
  paperFrequencyPercent: { type: Number, default: 0 },
  questionCount: { type: Number, default: 0 },
  yearsAppeared: [{ type: String }],
  totalMarks: { type: Number, default: 0 },
  averageMarksPerQuestion: { type: Number, default: 0 },
  hasLongAnswer: { type: Boolean, default: false },
  isExplicitSyllabusTopic: { type: Boolean, default: false },
  isWeakTopic: { type: Boolean, default: false },
  explanation: { type: String, default: "" }
});

const pyqAnalysisSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subjectId: {
      type: String,
      required: true,
      index: true,
    },
    subjectName: {
      type: String,
      required: true,
    },
    courseCode: {
      type: String,
      default: "",
    },
    university: {
      type: String,
      default: "",
    },
    semester: {
      type: String,
      default: "",
    },
    examType: {
      type: String,
      default: "Semester Exam",
    },
    examDate: {
      type: String,
      default: null,
    },
    papers: [paperMetadataSchema],
    questions: [questionSchema],
    topicPriorities: [topicPrioritySchema],
    syllabusCoverage: {
      totalSyllabusTopics: { type: Number, default: 0 },
      coveredTopicsCount: { type: Number, default: 0 },
      uncoveredTopicsCount: { type: Number, default: 0 },
      coveragePercentage: { type: Number, default: 0 },
      uncoveredTopics: [{
        unit: String,
        topicName: String,
        difficulty: String,
        reason: String
      }],
      coveredTopics: [{
        unit: String,
        topicName: String,
        appearances: Number,
        paperCount: Number
      }]
    },
    algorithmWeights: {
      paperFrequencyWeight: { type: Number, default: 0.35 },
      recurrenceWeight: { type: Number, default: 0.25 },
      marksWeight: { type: Number, default: 0.20 },
      questionVolumeWeight: { type: Number, default: 0.10 },
      syllabusBonus: { type: Number, default: 0.05 },
      weaknessBonus: { type: Number, default: 0.05 }
    },
    summaryNote: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true,
  }
);

// Compound index to ensure uniqueness per user and subject
pyqAnalysisSchema.index({ userId: 1, subjectId: 1 }, { unique: true });

const PYQAnalysis = mongoose.model("PYQAnalysis", pyqAnalysisSchema);

module.exports = PYQAnalysis;
