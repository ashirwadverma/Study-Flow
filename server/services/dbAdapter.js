const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const StudyData = require("../models/StudyData");
const PYQAnalysis = require("../models/PYQAnalysis");
const Quiz = require("../models/Quiz");
const AssessmentAttempt = require("../models/AssessmentAttempt");
const TopicProgress = require("../models/TopicProgress");
const NotificationEvent = require("../models/NotificationEvent");

// In-memory + disk fallback repository when MongoDB is not reachable
const LOCAL_STORE_FILE = path.join(__dirname, "..", "data", "local_store.json");

const memoryStore = {
  users: new Map(), // email -> userObject
  studyData: new Map(), // userId -> dataObject
  pyqData: new Map(), // `${userId}_${subjectId}` -> pyqObject
  quizzes: new Map(), // `${userId}_${topicId}` -> quizObject (or quizId -> quizObject)
  attempts: new Map(), // attemptId -> attemptObject
  topicProgress: new Map(), // `${userId}_${topicId}` -> progressObject
  notifications: new Map(), // idempotencyKey -> notificationObject
};

// Ensure data directory exists and load persisted storage
function initLocalStore() {
  try {
    const dataDir = path.dirname(LOCAL_STORE_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(LOCAL_STORE_FILE)) {
      const raw = fs.readFileSync(LOCAL_STORE_FILE, "utf8");
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (parsed.users && Array.isArray(parsed.users)) {
          parsed.users.forEach(([k, v]) => memoryStore.users.set(k, v));
        }
        if (parsed.studyData && Array.isArray(parsed.studyData)) {
          parsed.studyData.forEach(([k, v]) => memoryStore.studyData.set(k, v));
        }
        if (parsed.pyqData && Array.isArray(parsed.pyqData)) {
          parsed.pyqData.forEach(([k, v]) => memoryStore.pyqData.set(k, v));
        }
        if (parsed.quizzes && Array.isArray(parsed.quizzes)) {
          parsed.quizzes.forEach(([k, v]) => memoryStore.quizzes.set(k, v));
        }
        if (parsed.attempts && Array.isArray(parsed.attempts)) {
          parsed.attempts.forEach(([k, v]) => memoryStore.attempts.set(k, v));
        }
        if (parsed.topicProgress && Array.isArray(parsed.topicProgress)) {
          parsed.topicProgress.forEach(([k, v]) => memoryStore.topicProgress.set(k, v));
        }
        if (parsed.notifications && Array.isArray(parsed.notifications)) {
          parsed.notifications.forEach(([k, v]) => memoryStore.notifications.set(k, v));
        }
        console.log(
          `✓ Local disk storage loaded: ${memoryStore.users.size} users, ${memoryStore.studyData.size} study sets, ${memoryStore.pyqData.size} PYQ sets, ${memoryStore.quizzes.size} quizzes, ${memoryStore.topicProgress.size} topic progress records`
        );
      }
    }
  } catch (err) {
    console.warn("Notice loading local store file:", err.message);
  }
}

let saveDebounceTimer = null;
function persistLocalStore() {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    try {
      const dataDir = path.dirname(LOCAL_STORE_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const serializable = {
        users: Array.from(memoryStore.users.entries()),
        studyData: Array.from(memoryStore.studyData.entries()),
        pyqData: Array.from(memoryStore.pyqData.entries()),
        quizzes: Array.from(memoryStore.quizzes.entries()),
        attempts: Array.from(memoryStore.attempts.entries()),
        topicProgress: Array.from(memoryStore.topicProgress.entries()),
        notifications: Array.from(memoryStore.notifications.entries()),
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(serializable, null, 2), "utf8");
    } catch (err) {
      console.warn("Notice saving local store file:", err.message);
    }
  }, 100);
}

// Initialize on load
initLocalStore();

function isMongoConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

function wrapUserObject(u, cleanEmail) {
  if (!u) return null;
  const emailKey = cleanEmail || (u.email ? u.email.toLowerCase() : "");
  return {
    ...u,
    _id: u.id || u._id,
    id: u.id || u._id,
    async comparePassword(candidatePassword) {
      return bcrypt.compare(candidatePassword, u.password);
    },
    async save() {
      if (emailKey) {
        memoryStore.users.set(emailKey, { ...this });
        persistLocalStore();
      }
      return this;
    },
    toSafeObject() {
      const copy = { ...u, _id: u.id || u._id, id: u.id || u._id };
      delete copy.password;
      delete copy.verificationToken;
      delete copy.verificationTokenExpires;
      return copy;
    },
  };
}

// ─── USER REPOSITORY ──────────────────────────────────────────
async function findUserByEmail(email, includeSensitive = false) {
  const cleanEmail = (email || "").trim().toLowerCase();

  if (isMongoConnected()) {
    try {
      const query = User.findOne({ email: cleanEmail });
      if (includeSensitive) {
        query.select("+password +verificationToken +verificationTokenExpires");
      }
      return await query.exec();
    } catch (err) {
      console.warn("Mongo findUserByEmail error:", err.message);
    }
  }

  // Fallback
  const u = memoryStore.users.get(cleanEmail);
  if (!u) return null;
  return wrapUserObject(u, cleanEmail);
}

async function findUserById(id) {
  if (!id) return null;

  if (isMongoConnected()) {
    try {
      return await User.findById(id).exec();
    } catch (err) {
      console.warn("Mongo findUserById error:", err.message);
    }
  }

  // Fallback
  for (const u of memoryStore.users.values()) {
    if (String(u.id) === String(id) || String(u._id) === String(id)) {
      return wrapUserObject(u, u.email);
    }
  }
  return null;
}

async function findUserByVerificationToken(token) {
  if (!token) return null;

  if (isMongoConnected()) {
    try {
      return await User.findOne({ verificationToken: token })
        .select("+verificationToken +verificationTokenExpires")
        .exec();
    } catch (err) {
      console.warn("Mongo findUserByVerificationToken error:", err.message);
    }
  }

  // Fallback
  for (const u of memoryStore.users.values()) {
    if (u.verificationToken === token) {
      return wrapUserObject(u, u.email);
    }
  }
  return null;
}

async function createUser({ name, email, password, verificationToken, verificationTokenExpires }) {
  const cleanEmail = (email || "").trim().toLowerCase();

  if (isMongoConnected()) {
    try {
      const newUser = new User({
        name: name.trim(),
        email: cleanEmail,
        password,
        isVerified: false,
        verificationToken,
        verificationTokenExpires,
      });
      return await newUser.save();
    } catch (err) {
      console.warn("Mongo createUser error:", err.message);
      if (err.code === 11000) throw err;
    }
  }

  // Fallback creation with bcrypt hashing
  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(password, salt);
  const userId = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const userObj = {
    id: userId,
    _id: userId,
    name: name.trim(),
    email: cleanEmail,
    password: hashedPassword,
    isVerified: false,
    verificationToken,
    verificationTokenExpires,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLogin: null,
  };

  memoryStore.users.set(cleanEmail, userObj);
  persistLocalStore();

  return wrapUserObject(userObj, cleanEmail);
}

// ─── STUDY DATA REPOSITORY ────────────────────────────────────
async function getUserStudyData(userId) {
  if (isMongoConnected()) {
    try {
      let data = await StudyData.findOne({ userId }).exec();
      if (!data) {
        data = await StudyData.create({
          userId,
          subjects: [],
          sessions: [],
          notes: {},
          activity: [],
          settings: {},
        });
      }
      return data;
    } catch (err) {
      console.warn("Mongo getUserStudyData error:", err.message);
    }
  }

  // Fallback
  const key = String(userId);
  if (!memoryStore.studyData.has(key)) {
    memoryStore.studyData.set(key, {
      userId: key,
      subjects: [],
      sessions: [],
      notes: {},
      activity: [],
      settings: {},
    });
    persistLocalStore();
  }
  return memoryStore.studyData.get(key);
}

async function saveUserStudyData(userId, updateFields) {
  if (isMongoConnected()) {
    try {
      const updated = await StudyData.findOneAndUpdate(
        { userId },
        { $set: updateFields },
        { new: true, upsert: true }
      ).exec();
      return updated;
    } catch (err) {
      console.warn("Mongo saveUserStudyData error:", err.message);
    }
  }

  // Fallback
  const key = String(userId);
  const existing = await getUserStudyData(userId);
  const updated = {
    ...existing,
    ...updateFields,
    updatedAt: new Date(),
  };
  memoryStore.studyData.set(key, updated);
  persistLocalStore();
  return updated;
}

// ─── PYQ ANALYSIS REPOSITORY ──────────────────────────────────
async function getPYQAnalysis(userId, subjectId) {
  if (isMongoConnected()) {
    try {
      return await PYQAnalysis.findOne({ userId, subjectId }).exec();
    } catch (err) {
      console.warn("Mongo getPYQAnalysis error:", err.message);
    }
  }

  const key = `${String(userId)}_${String(subjectId)}`;
  return memoryStore.pyqData.get(key) || null;
}

async function savePYQAnalysis(userId, subjectId, pyqData) {
  if (isMongoConnected()) {
    try {
      return await PYQAnalysis.findOneAndUpdate(
        { userId, subjectId },
        { $set: { ...pyqData, userId, subjectId } },
        { new: true, upsert: true }
      ).exec();
    } catch (err) {
      console.warn("Mongo savePYQAnalysis error:", err.message);
    }
  }

  const key = `${String(userId)}_${String(subjectId)}`;
  const record = {
    ...pyqData,
    userId: String(userId),
    subjectId: String(subjectId),
    updatedAt: new Date(),
  };
  memoryStore.pyqData.set(key, record);
  persistLocalStore();
  return record;
}

async function getUserPYQHistory(userId) {
  if (isMongoConnected()) {
    try {
      return await PYQAnalysis.find({ userId })
        .select("subjectId subjectName courseCode university semester examType examDate papers topicPriorities syllabusCoverage updatedAt createdAt")
        .sort({ updatedAt: -1 })
        .exec();
    } catch (err) {
      console.warn("Mongo getUserPYQHistory error:", err.message);
    }
  }

  const uid = String(userId);
  const results = [];
  for (const [key, val] of memoryStore.pyqData.entries()) {
    if (key.startsWith(`${uid}_`)) {
      results.push(val);
    }
  }
  return results.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

async function deletePYQAnalysis(userId, subjectId) {
  if (isMongoConnected()) {
    try {
      return await PYQAnalysis.findOneAndDelete({ userId, subjectId }).exec();
    } catch (err) {
      console.warn("Mongo deletePYQAnalysis error:", err.message);
    }
  }

  const key = `${String(userId)}_${String(subjectId)}`;
  const deleted = memoryStore.pyqData.delete(key);
  persistLocalStore();
  return deleted;
}

// ─── ASSESSMENT & QUIZ REPOSITORY ────────────────────────────
async function saveQuiz(quizData) {
  const uid = String(quizData.userId);
  const tid = String(quizData.topicId);
  const qid = String(quizData.quizId);

  if (isMongoConnected()) {
    try {
      return await Quiz.findOneAndUpdate(
        { quizId: qid },
        { $set: quizData },
        { new: true, upsert: true }
      ).exec();
    } catch (err) {
      console.warn("Mongo saveQuiz error:", err.message);
    }
  }

  const record = {
    ...quizData,
    userId: uid,
    topicId: tid,
    quizId: qid,
    updatedAt: new Date(),
  };
  memoryStore.quizzes.set(qid, record);
  memoryStore.quizzes.set(`${uid}_${tid}`, record);
  persistLocalStore();
  return record;
}

async function getQuizByTopic(userId, topicId) {
  const uid = String(userId);
  const tid = String(topicId);

  if (isMongoConnected()) {
    try {
      return await Quiz.findOne({ userId: uid, topicId: tid }).sort({ version: -1, createdAt: -1 }).exec();
    } catch (err) {
      console.warn("Mongo getQuizByTopic error:", err.message);
    }
  }

  return memoryStore.quizzes.get(`${uid}_${tid}`) || null;
}

async function getQuizById(quizId) {
  const qid = String(quizId);

  if (isMongoConnected()) {
    try {
      return await Quiz.findOne({ quizId: qid }).exec();
    } catch (err) {
      console.warn("Mongo getQuizById error:", err.message);
    }
  }

  return memoryStore.quizzes.get(qid) || null;
}

// ─── ASSESSMENT ATTEMPTS REPOSITORY ──────────────────────────
async function saveAttempt(attemptData) {
  const aid = String(attemptData.attemptId);

  if (isMongoConnected()) {
    try {
      return await AssessmentAttempt.create(attemptData);
    } catch (err) {
      console.warn("Mongo saveAttempt error:", err.message);
    }
  }

  const record = {
    ...attemptData,
    attemptId: aid,
    userId: String(attemptData.userId),
    topicId: String(attemptData.topicId),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  memoryStore.attempts.set(aid, record);
  persistLocalStore();
  return record;
}

async function getAttemptsByTopic(userId, topicId) {
  const uid = String(userId);
  const tid = String(topicId);

  if (isMongoConnected()) {
    try {
      return await AssessmentAttempt.find({ userId: uid, topicId: tid })
        .sort({ submittedAt: -1, createdAt: -1 })
        .exec();
    } catch (err) {
      console.warn("Mongo getAttemptsByTopic error:", err.message);
    }
  }

  const results = [];
  for (const att of memoryStore.attempts.values()) {
    if (String(att.userId) === uid && String(att.topicId) === tid) {
      results.push(att);
    }
  }
  return results.sort((a, b) => new Date(b.submittedAt || b.createdAt || 0) - new Date(a.submittedAt || a.createdAt || 0));
}

async function getAttemptById(attemptId) {
  const aid = String(attemptId);

  if (isMongoConnected()) {
    try {
      return await AssessmentAttempt.findOne({ attemptId: aid }).exec();
    } catch (err) {
      console.warn("Mongo getAttemptById error:", err.message);
    }
  }

  return memoryStore.attempts.get(aid) || null;
}

async function getUserAttempts(userId) {
  const uid = String(userId);

  if (isMongoConnected()) {
    try {
      return await AssessmentAttempt.find({ userId: uid })
        .sort({ submittedAt: -1, createdAt: -1 })
        .exec();
    } catch (err) {
      console.warn("Mongo getUserAttempts error:", err.message);
    }
  }

  const results = [];
  for (const att of memoryStore.attempts.values()) {
    if (String(att.userId) === uid) {
      results.push(att);
    }
  }
  return results.sort((a, b) => new Date(b.submittedAt || b.createdAt || 0) - new Date(a.submittedAt || a.createdAt || 0));
}

// ─── TOPIC PROGRESS REPOSITORY ───────────────────────────────
async function getTopicProgress(userId, topicId) {
  const uid = String(userId);
  const tid = String(topicId);

  if (isMongoConnected()) {
    try {
      return await TopicProgress.findOne({ userId: uid, topicId: tid }).exec();
    } catch (err) {
      console.warn("Mongo getTopicProgress error:", err.message);
    }
  }

  const key = `${uid}_${tid}`;
  return memoryStore.topicProgress.get(key) || null;
}

async function saveTopicProgress(userId, topicId, updateData) {
  const uid = String(userId);
  const tid = String(topicId);

  if (isMongoConnected()) {
    try {
      return await TopicProgress.findOneAndUpdate(
        { userId: uid, topicId: tid },
        { $set: { ...updateData, userId: uid, topicId: tid } },
        { new: true, upsert: true }
      ).exec();
    } catch (err) {
      console.warn("Mongo saveTopicProgress error:", err.message);
    }
  }

  const key = `${uid}_${tid}`;
  const existing = memoryStore.topicProgress.get(key) || {
    userId: uid,
    topicId: tid,
    status: "not_started",
    bestScore: 0,
    latestScore: 0,
    totalAttempts: 0,
    pyqPracticeStatus: "not_started",
    createdAt: new Date(),
  };

  const updated = {
    ...existing,
    ...updateData,
    userId: uid,
    topicId: tid,
    updatedAt: new Date(),
  };
  memoryStore.topicProgress.set(key, updated);
  persistLocalStore();
  return updated;
}

async function getAllTopicProgress(userId, subjectId = null) {
  const uid = String(userId);

  if (isMongoConnected()) {
    try {
      const query = { userId: uid };
      if (subjectId) query.subjectId = String(subjectId);
      return await TopicProgress.find(query).exec();
    } catch (err) {
      console.warn("Mongo getAllTopicProgress error:", err.message);
    }
  }

  const results = [];
  for (const prog of memoryStore.topicProgress.values()) {
    if (String(prog.userId) === uid) {
      if (!subjectId || String(prog.subjectId) === String(subjectId)) {
        results.push(prog);
      }
    }
  }
  return results;
}

async function isTopicCompleted(userId, topicId) {
  const prog = await getTopicProgress(userId, topicId);
  return !!(prog && prog.status === "completed" && prog.qualifyingAttemptId);
}

// ─── NOTIFICATION EVENTS REPOSITORY ──────────────────────────
async function saveNotificationEvent(eventData) {
  const key = String(eventData.idempotencyKey);

  if (isMongoConnected()) {
    try {
      return await NotificationEvent.findOneAndUpdate(
        { idempotencyKey: key },
        { $set: eventData },
        { new: true, upsert: true }
      ).exec();
    } catch (err) {
      console.warn("Mongo saveNotificationEvent error:", err.message);
    }
  }

  const record = {
    ...eventData,
    idempotencyKey: key,
    userId: String(eventData.userId),
    updatedAt: new Date(),
  };
  memoryStore.notifications.set(key, record);
  persistLocalStore();
  return record;
}

async function getNotificationEventByIdempotencyKey(key) {
  const cleanKey = String(key);

  if (isMongoConnected()) {
    try {
      return await NotificationEvent.findOne({ idempotencyKey: cleanKey }).exec();
    } catch (err) {
      console.warn("Mongo getNotificationEventByIdempotencyKey error:", err.message);
    }
  }

  return memoryStore.notifications.get(cleanKey) || null;
}

async function getUserNotifications(userId) {
  const uid = String(userId);

  if (isMongoConnected()) {
    try {
      return await NotificationEvent.find({ userId: uid })
        .sort({ createdAt: -1 })
        .exec();
    } catch (err) {
      console.warn("Mongo getUserNotifications error:", err.message);
    }
  }

  const results = [];
  for (const notif of memoryStore.notifications.values()) {
    if (String(notif.userId) === uid) {
      results.push(notif);
    }
  }
  return results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

// ─── USER PREFERENCES REPOSITORY ─────────────────────────────
async function getUserNotificationPreferences(userId) {
  const user = await findUserById(userId);
  if (!user) return { achievementEmails: true };
  const settings = user.settings || {};
  return {
    achievementEmails: settings.achievementEmails !== false, // default true
  };
}

async function updateUserNotificationPreferences(userId, preferences) {
  const uid = String(userId);

  if (isMongoConnected()) {
    try {
      const user = await User.findById(uid).exec();
      if (user) {
        user.settings = user.settings || {};
        if (preferences.achievementEmails !== undefined) {
          user.settings.achievementEmails = !!preferences.achievementEmails;
        }
        await user.save();
        return user.settings;
      }
    } catch (err) {
      console.warn("Mongo updateUserNotificationPreferences error:", err.message);
    }
  }

  // Fallback
  for (const u of memoryStore.users.values()) {
    if (String(u.id) === uid || String(u._id) === uid) {
      u.settings = u.settings || {};
      if (preferences.achievementEmails !== undefined) {
        u.settings.achievementEmails = !!preferences.achievementEmails;
      }
      persistLocalStore();
      return u.settings;
    }
  }
  return { achievementEmails: true };
}

module.exports = {
  isMongoConnected,
  findUserByEmail,
  findUserById,
  findUserByVerificationToken,
  createUser,
  getUserStudyData,
  saveUserStudyData,
  getPYQAnalysis,
  savePYQAnalysis,
  getUserPYQHistory,
  deletePYQAnalysis,
  // Assessments & Quizzes
  saveQuiz,
  getQuizByTopic,
  getQuizById,
  // Attempts
  saveAttempt,
  getAttemptsByTopic,
  getAttemptById,
  getUserAttempts,
  // Topic Progress
  getTopicProgress,
  saveTopicProgress,
  getAllTopicProgress,
  isTopicCompleted,
  // Notifications
  saveNotificationEvent,
  getNotificationEventByIdempotencyKey,
  getUserNotifications,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
};

