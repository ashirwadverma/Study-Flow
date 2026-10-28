const mongoose = require("mongoose");

const studyDataSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    subjects: {
      type: Array,
      default: [],
    },
    sessions: {
      type: Array,
      default: [],
    },
    notes: {
      type: Object,
      default: {},
    },
    activity: {
      type: Array,
      default: [],
    },
    settings: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

const StudyData = mongoose.model("StudyData", studyDataSchema);

module.exports = StudyData;
