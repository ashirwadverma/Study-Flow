const mongoose = require("mongoose");

const notificationEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  topicId: { type: String, required: true, index: true },
  subjectId: { type: String, required: true },
  eventType: { type: String, default: "topic_completed_achievement" },
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  recipientEmail: { type: String, required: true },
  recipientName: { type: String, default: "Student" },
  topicName: { type: String, required: true },
  subjectName: { type: String, required: true },
  score: { type: Number, required: true },
  qualifyingAttemptId: { type: String, required: true },
  deliveryStatus: {
    type: String,
    enum: ["sent", "pending", "failed", "disabled", "dev_logged"],
    default: "pending",
    index: true
  },
  retryCount: { type: Number, default: 0 },
  providerMessageId: { type: String, default: null },
  sentAt: { type: Date, default: null },
  lastError: { type: String, default: null }
}, {
  timestamps: true
});

notificationEventSchema.index({ userId: 1, createdAt: -1 });

const NotificationEvent = mongoose.model("NotificationEvent", notificationEventSchema);

module.exports = NotificationEvent;
