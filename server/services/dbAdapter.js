/**
 * server/services/dbAdapter.js
 * Supabase-Powered Cloud Database Adapter for StudyFlow
 *
 * Persists all study sets, PYQs, topic assessments, attempts, and preferences
 * directly to Supabase PostgreSQL with zero local file storage dependency.
 */

const { getSupabaseClient } = require("../config/supabase");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

// Active process cache (ephemeral, zero disk I/O)
const runtimeCache = {
  users: new Map(),
  studyData: new Map(),
  pyqData: new Map(),
  quizzes: new Map(),
  attempts: new Map(),
  topicProgress: new Map(),
  notifications: new Map(),
};

function isMongoConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

function getSupabase(clientOverride) {
  try {
    return getSupabaseClient(clientOverride);
  } catch (_) {
    return null;
  }
}

// ─── 1. USER REPOSITORY ──────────────────────────────────────────
function wrapUserObject(u, cleanEmail) {
  if (!u) return null;
  return {
    ...u,
    _id: u.id || u._id,
    id: u.id || u._id,
    async comparePassword(candidatePassword) {
      return bcrypt.compare(candidatePassword, u.password || "");
    },
    async save() {
      if (cleanEmail) runtimeCache.users.set(cleanEmail, { ...this });
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

async function findUserByEmail(email, includeSensitive = false) {
  const cleanEmail = (email || "").trim().toLowerCase();

  // Try Supabase auth / database
  const sb = getSupabase();
  if (sb && sb.auth) {
    try {
      const cached = runtimeCache.users.get(cleanEmail);
      if (cached) return wrapUserObject(cached, cleanEmail);
    } catch (_) {}
  }

  if (isMongoConnected()) {
    try {
      const query = User.findOne({ email: cleanEmail });
      if (includeSensitive) query.select("+password +verificationToken +verificationTokenExpires");
      return await query.exec();
    } catch (_) {}
  }

  const u = runtimeCache.users.get(cleanEmail);
  return u ? wrapUserObject(u, cleanEmail) : null;
}

async function findUserById(id) {
  if (!id) return null;

  const sb = getSupabase();
  if (sb && sb.auth) {
    try {
      // Find in runtime cache first
      for (const u of runtimeCache.users.values()) {
        if (String(u.id) === String(id) || String(u._id) === String(id)) {
          return wrapUserObject(u, u.email);
        }
      }
    } catch (_) {}
  }

  if (isMongoConnected()) {
    try {
      return await User.findById(id).exec();
    } catch (_) {}
  }

  for (const u of runtimeCache.users.values()) {
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
      return await User.findOne({ verificationToken: token }).exec();
    } catch (_) {}
  }
  for (const u of runtimeCache.users.values()) {
    if (u.verificationToken === token) return wrapUserObject(u, u.email);
  }
  return null;
}

async function createUser({ name, email, password, verificationToken, verificationTokenExpires }) {
  const cleanEmail = (email || "").trim().toLowerCase();
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

  runtimeCache.users.set(cleanEmail, userObj);
  return wrapUserObject(userObj, cleanEmail);
}

// ─── 2. STUDY DATA REPOSITORY (Supabase table: study_data) ───────
async function getUserStudyData(userId, clientOverride) {
  const uid = String(userId);
  const sb = getSupabase(clientOverride);

  if (sb && sb.from) {
    try {
      const { data, error } = await sb
        .from("study_data")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();

      if (!error && data) {
        const result = {
          userId: data.user_id,
          subjects: data.subjects || [],
          sessions: data.sessions || [],
          notes: data.notes || {},
          activity: data.activity || [],
          settings: data.settings || {},
        };
        runtimeCache.studyData.set(uid, result);
        return result;
      } else if (error) {
        console.warn("Supabase getUserStudyData notice:", error.message);
      }
    } catch (err) {
      console.warn("Supabase getUserStudyData notice:", err.message);
    }
  }

  // Runtime fallback
  if (!runtimeCache.studyData.has(uid)) {
    runtimeCache.studyData.set(uid, {
      userId: uid,
      subjects: [],
      sessions: [],
      notes: {},
      activity: [],
      settings: {},
    });
  }
  return runtimeCache.studyData.get(uid);
}

async function saveUserStudyData(userId, updateFields, clientOverride) {
  const uid = String(userId);
  const sb = getSupabase(clientOverride);
  const existing = await getUserStudyData(userId, clientOverride);

  const merged = {
    ...existing,
    ...updateFields,
    updatedAt: new Date().toISOString(),
  };
  runtimeCache.studyData.set(uid, merged);

  if (sb && sb.from) {
    try {
      const payload = {
        user_id: uid,
        subjects: merged.subjects || [],
        sessions: merged.sessions || [],
        notes: merged.notes || {},
        activity: merged.activity || [],
        settings: merged.settings || {},
        updated_at: new Date().toISOString(),
      };

      const { error } = await sb.from("study_data").upsert(payload, { onConflict: "user_id" });
      if (error) {
        console.error("Supabase saveUserStudyData error:", error.message);
      } else {
        console.log(`[Supabase] Successfully saved study_data for user ${uid}`);
      }
    } catch (err) {
      console.warn("Supabase saveUserStudyData notice:", err.message);
    }
  }

  return merged;
}

// ─── 3. PYQ ANALYSIS REPOSITORY (Supabase table: pyq_analyses) ───
async function getPYQAnalysis(userId, subjectId, clientOverride) {
  const uid = String(userId);
  const sid = String(subjectId);
  const key = `${uid}_${sid}`;
  const sb = getSupabase(clientOverride);

  if (sb && sb.from) {
    try {
      const { data, error } = await sb
        .from("pyq_analyses")
        .select("*")
        .eq("user_id", uid)
        .eq("subject_id", sid)
        .maybeSingle();

      if (!error && data) {
        const record = {
          userId: data.user_id,
          subjectId: data.subject_id,
          subjectName: data.subject_name,
          courseCode: data.course_code,
          university: data.university,
          semester: data.semester,
          examType: data.exam_type,
          examDate: data.exam_date,
          papers: data.papers || [],
          questions: data.questions || [],
          topicPriorities: data.topic_priorities || [],
          syllabusCoverage: data.syllabus_coverage || {},
          raw_data: data.raw_data || {},
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
        runtimeCache.pyqData.set(key, record);
        return record;
      }
    } catch (err) {
      console.warn("Supabase getPYQAnalysis notice:", err.message);
    }
  }

  return runtimeCache.pyqData.get(key) || null;
}

async function savePYQAnalysis(userId, subjectId, pyqData, clientOverride) {
  const uid = String(userId);
  const sid = String(subjectId);
  const key = `${uid}_${sid}`;
  const sb = getSupabase(clientOverride);

  const record = {
    ...pyqData,
    userId: uid,
    subjectId: sid,
    updatedAt: new Date().toISOString(),
  };
  runtimeCache.pyqData.set(key, record);

  if (sb && sb.from) {
    try {
      const payload = {
        user_id: uid,
        subject_id: sid,
        subject_name: record.subjectName || sid,
        course_code: record.courseCode || null,
        university: record.university || null,
        semester: record.semester || null,
        exam_type: record.examType || null,
        exam_date: record.examDate || null,
        papers: record.papers || [],
        questions: record.questions || [],
        topic_priorities: record.topicPriorities || [],
        syllabus_coverage: record.syllabusCoverage || {},
        raw_data: record.raw_data || record.rawData || {},
        updated_at: new Date().toISOString(),
      };

      const { error } = await sb.from("pyq_analyses").upsert(payload, { onConflict: "user_id,subject_id" });
      if (error) {
        console.error("Supabase pyq_analyses upsert error:", error.message, error.details || "");
      } else {
        console.log(`[Supabase] Successfully saved pyq_analyses for user ${uid}, subject ${sid}`);
      }
    } catch (err) {
      console.warn("Supabase savePYQAnalysis notice:", err.message);
    }
  }

  return record;
}

async function getUserPYQHistory(userId, clientOverride) {
  const uid = String(userId);
  const sb = getSupabase(clientOverride);

  if (sb && sb.from) {
    try {
      const { data, error } = await sb
        .from("pyq_analyses")
        .select("subject_id, subject_name, course_code, university, semester, exam_type, exam_date, papers, topic_priorities, syllabus_coverage, updated_at, created_at")
        .eq("user_id", uid)
        .order("updated_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        return data.map(d => ({
          subjectId: d.subject_id,
          subjectName: d.subject_name,
          courseCode: d.course_code,
          university: d.university,
          semester: d.semester,
          examType: d.exam_type,
          examDate: d.exam_date,
          papers: d.papers || [],
          topicPriorities: d.topic_priorities || [],
          syllabusCoverage: d.syllabus_coverage || {},
          updatedAt: d.updated_at,
          createdAt: d.created_at,
        }));
      }
    } catch (err) {
      console.warn("Supabase getUserPYQHistory notice:", err.message);
    }
  }

  const results = [];
  for (const [key, val] of runtimeCache.pyqData.entries()) {
    if (key.startsWith(`${uid}_`)) results.push(val);
  }
  return results.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

async function deletePYQAnalysis(userId, subjectId, clientOverride) {
  const uid = String(userId);
  const sid = String(subjectId);
  const key = `${uid}_${sid}`;
  const sb = getSupabase(clientOverride);

  runtimeCache.pyqData.delete(key);

  if (sb && sb.from) {
    try {
      const { error } = await sb.from("pyq_analyses").delete().eq("user_id", uid).eq("subject_id", sid);
      if (error) {
        console.error("Supabase deletePYQAnalysis error:", error.message);
      } else {
        console.log(`[Supabase] Successfully deleted pyq_analyses for user ${uid}, subject ${sid}`);
      }
    } catch (err) {
      console.warn("Supabase deletePYQAnalysis notice:", err.message);
    }
  }

  return true;
}

// ─── 4. ASSESSMENT & QUIZ REPOSITORY (Supabase table: quizzes) ───
async function saveQuiz(quizData, clientOverride) {
  const uid = String(quizData.userId);
  const tid = String(quizData.topicId);
  const qid = String(quizData.quizId);
  const sb = getSupabase(clientOverride);

  const record = {
    ...quizData,
    userId: uid,
    topicId: tid,
    quizId: qid,
    updatedAt: new Date().toISOString(),
  };

  runtimeCache.quizzes.set(qid, record);
  runtimeCache.quizzes.set(`${uid}_${tid}`, record);

  if (sb && sb.from) {
    try {
      const payload = {
        quiz_id: qid,
        user_id: uid,
        topic_id: tid,
        topic_name: quizData.topicName || tid,
        subject_id: quizData.subjectId || null,
        subject_name: quizData.subjectName || null,
        questions: quizData.questions || [],
        version: quizData.version || 1,
        updated_at: new Date().toISOString(),
      };
      const { error } = await sb.from("quizzes").upsert(payload, { onConflict: "quiz_id" });
      if (error) {
        console.error("Supabase quizzes upsert error:", error.message);
      } else {
        console.log(`[Supabase] Successfully saved quiz ${qid} for user ${uid}, topic ${tid}`);
      }
    } catch (err) {
      console.warn("Supabase saveQuiz notice:", err.message);
    }
  }

  return record;
}

async function getQuizByTopic(userId, topicId, clientOverride) {
  const uid = String(userId);
  const tid = String(topicId);
  const sb = getSupabase(clientOverride);

  if (sb && sb.from) {
    try {
      const { data, error } = await sb
        .from("quizzes")
        .select("*")
        .eq("user_id", uid)
        .eq("topic_id", tid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        return {
          quizId: data.quiz_id,
          userId: data.user_id,
          topicId: data.topic_id,
          topicName: data.topic_name,
          subjectId: data.subject_id,
          subjectName: data.subject_name,
          questions: data.questions || [],
          version: data.version || 1,
          createdAt: data.created_at,
        };
      }
    } catch (err) {
      console.warn("Supabase getQuizByTopic notice:", err.message);
    }
  }

  return runtimeCache.quizzes.get(`${uid}_${tid}`) || null;
}

async function getQuizById(quizId, clientOverride) {
  const qid = String(quizId);
  const sb = getSupabase(clientOverride);

  if (sb && sb.from) {
    try {
      const { data, error } = await sb
        .from("quizzes")
        .select("*")
        .eq("quiz_id", qid)
        .maybeSingle();

      if (!error && data) {
        return {
          quizId: data.quiz_id,
          userId: data.user_id,
          topicId: data.topic_id,
          topicName: data.topic_name,
          subjectId: data.subject_id,
          subjectName: data.subject_name,
          questions: data.questions || [],
          version: data.version || 1,
          createdAt: data.created_at,
        };
      }
    } catch (err) {
      console.warn("Supabase getQuizById notice:", err.message);
    }
  }

  return runtimeCache.quizzes.get(qid) || null;
}

// ─── 5. ATTEMPTS REPOSITORY (Supabase table: assessment_attempts) ─
async function saveAttempt(attemptData, clientOverride) {
  const aid = String(attemptData.attemptId);
  const sb = getSupabase(clientOverride);

  const record = {
    ...attemptData,
    attemptId: aid,
    userId: String(attemptData.userId),
    topicId: String(attemptData.topicId),
    createdAt: new Date().toISOString(),
  };

  runtimeCache.attempts.set(aid, record);

  if (sb && sb.from) {
    try {
      const payload = {
        attempt_id: aid,
        quiz_id: String(attemptData.quizId),
        user_id: String(attemptData.userId),
        topic_id: String(attemptData.topicId),
        score: Number(attemptData.score) || 0,
        total_questions: Number(attemptData.totalQuestions) || 10,
        percentage: Number(attemptData.percentage) || 0,
        passed: Boolean(attemptData.passed),
        answers: attemptData.answers || {},
        question_results: attemptData.questionBreakdown || attemptData.questionResults || attemptData.question_results || [],
        started_at: attemptData.startedAt || null,
        completed_at: new Date().toISOString(),
      };
      const { error } = await sb.from("assessment_attempts").upsert(payload, { onConflict: "attempt_id" });
      if (error) {
        console.error("Supabase assessment_attempts upsert error:", error.message, error.details || "", error.hint || "");
      } else {
        console.log(`[Supabase] Successfully saved assessment attempt ${aid} for user ${payload.user_id}`);
      }
    } catch (err) {
      console.warn("Supabase saveAttempt notice:", err.message);
    }
  }

  return record;
}

async function getAttemptsByTopic(userId, topicId, clientOverride) {
  const uid = String(userId);
  const tid = String(topicId);
  const sb = getSupabase(clientOverride);

  if (sb && sb.from) {
    try {
      const { data, error } = await sb
        .from("assessment_attempts")
        .select("*")
        .eq("user_id", uid)
        .eq("topic_id", tid)
        .order("completed_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        return data.map(d => ({
          attemptId: d.attempt_id,
          quizId: d.quiz_id,
          userId: d.user_id,
          topicId: d.topic_id,
          score: d.score,
          totalQuestions: d.total_questions,
          percentage: d.percentage,
          passed: d.passed,
          answers: d.answers || {},
          questionResults: d.question_results || [],
          startedAt: d.started_at,
          completedAt: d.completed_at,
        }));
      }
    } catch (err) {
      console.warn("Supabase getAttemptsByTopic notice:", err.message);
    }
  }

  const results = [];
  for (const att of runtimeCache.attempts.values()) {
    if (String(att.userId) === uid && String(att.topicId) === tid) results.push(att);
  }
  return results.sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
}

async function getAttemptById(attemptId, clientOverride) {
  const aid = String(attemptId);
  const sb = getSupabase(clientOverride);

  if (sb && sb.from) {
    try {
      const { data, error } = await sb
        .from("assessment_attempts")
        .select("*")
        .eq("attempt_id", aid)
        .maybeSingle();

      if (!error && data) {
        return {
          attemptId: data.attempt_id,
          quizId: data.quiz_id,
          userId: data.user_id,
          topicId: data.topic_id,
          score: data.score,
          totalQuestions: data.total_questions,
          percentage: data.percentage,
          passed: data.passed,
          answers: data.answers || {},
          questionResults: data.question_results || [],
          startedAt: data.started_at,
          completedAt: data.completed_at,
        };
      }
    } catch (err) {
      console.warn("Supabase getAttemptById notice:", err.message);
    }
  }

  return runtimeCache.attempts.get(aid) || null;
}

async function getUserAttempts(userId, clientOverride) {
  const uid = String(userId);
  const sb = getSupabase(clientOverride);

  if (sb && sb.from) {
    try {
      const { data, error } = await sb
        .from("assessment_attempts")
        .select("*")
        .eq("user_id", uid)
        .order("completed_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        return data.map(d => ({
          attemptId: d.attempt_id,
          quizId: d.quiz_id,
          userId: d.user_id,
          topicId: d.topic_id,
          score: d.score,
          totalQuestions: d.total_questions,
          percentage: d.percentage,
          passed: d.passed,
          completedAt: d.completed_at,
        }));
      }
    } catch (err) {
      console.warn("Supabase getUserAttempts notice:", err.message);
    }
  }

  const results = [];
  for (const att of runtimeCache.attempts.values()) {
    if (String(att.userId) === uid) results.push(att);
  }
  return results.sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
}

// ─── 6. TOPIC PROGRESS REPOSITORY (Supabase table: topic_progress) ─
async function getTopicProgress(userId, topicId, clientOverride) {
  const uid = String(userId);
  const tid = String(topicId);
  const sb = getSupabase(clientOverride);

  if (sb && sb.from) {
    try {
      const { data, error } = await sb
        .from("topic_progress")
        .select("*")
        .eq("user_id", uid)
        .eq("topic_id", tid)
        .maybeSingle();

      if (!error && data) {
        return {
          userId: data.user_id,
          topicId: data.topic_id,
          status: data.status,
          bestScore: Number(data.best_score) || 0,
          attemptsCount: Number(data.attempts_count) || 0,
          lastAttemptAt: data.last_attempt_at,
          completedAt: data.completed_at,
          qualifyingAttemptId: data.status === "completed" ? "verified" : null,
        };
      }
    } catch (err) {
      console.warn("Supabase getTopicProgress notice:", err.message);
    }
  }

  return runtimeCache.topicProgress.get(`${uid}_${tid}`) || null;
}

async function saveTopicProgress(userId, topicId, updateData, clientOverride) {
  const uid = String(userId);
  const tid = String(topicId);
  const key = `${uid}_${tid}`;
  const sb = getSupabase(clientOverride);

  const existing = runtimeCache.topicProgress.get(key) || {
    userId: uid,
    topicId: tid,
    status: "pending",
    bestScore: 0,
    attemptsCount: 0,
  };

  const updated = {
    ...existing,
    ...updateData,
    userId: uid,
    topicId: tid,
    updatedAt: new Date().toISOString(),
  };
  runtimeCache.topicProgress.set(key, updated);

  if (sb && sb.from) {
    try {
      const payload = {
        user_id: uid,
        topic_id: tid,
        status: updated.status || "pending",
        best_score: Number(updated.bestScore) || 0,
        attempts_count: Number(updated.attemptsCount || updated.totalAttempts) || 0,
        last_attempt_at: updated.lastAttemptAt || new Date().toISOString(),
        completed_at: updated.completedAt || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await sb.from("topic_progress").upsert(payload, { onConflict: "user_id,topic_id" });
      if (error) {
        console.error("Supabase topic_progress upsert error:", error.message);
      } else {
        console.log(`[Supabase] Successfully saved topic_progress for user ${uid}, topic ${tid} (${payload.status})`);
      }
    } catch (err) {
      console.warn("Supabase saveTopicProgress notice:", err.message);
    }
  }

  return updated;
}

async function getAllTopicProgress(userId) {
  const uid = String(userId);
  const sb = getSupabase();

  if (sb && sb.from) {
    try {
      const { data, error } = await sb
        .from("topic_progress")
        .select("*")
        .eq("user_id", uid);

      if (!error && Array.isArray(data)) {
        return data.map(d => ({
          userId: d.user_id,
          topicId: d.topic_id,
          status: d.status,
          bestScore: d.best_score,
          attemptsCount: d.attempts_count,
        }));
      }
    } catch (err) {
      console.warn("Supabase getAllTopicProgress notice:", err.message);
    }
  }

  const results = [];
  for (const prog of runtimeCache.topicProgress.values()) {
    if (String(prog.userId) === uid) results.push(prog);
  }
  return results;
}

async function isTopicCompleted(userId, topicId) {
  const prog = await getTopicProgress(userId, topicId);
  return Boolean(prog && (prog.status === "completed" || prog.status === "done"));
}

// ─── 7. NOTIFICATIONS & PREFERENCES (Supabase table: notification_preferences) ─
async function saveNotificationEvent(eventData) {
  const key = String(eventData.idempotencyKey);
  const record = {
    ...eventData,
    idempotencyKey: key,
    userId: String(eventData.userId),
    updatedAt: new Date().toISOString(),
  };
  runtimeCache.notifications.set(key, record);
  return record;
}

async function getNotificationEventByIdempotencyKey(key) {
  return runtimeCache.notifications.get(String(key)) || null;
}

async function getUserNotifications(userId) {
  const uid = String(userId);
  const results = [];
  for (const notif of runtimeCache.notifications.values()) {
    if (String(notif.userId) === uid) results.push(notif);
  }
  return results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function getUserNotificationPreferences(userId) {
  const uid = String(userId);
  const sb = getSupabase();

  if (sb && sb.from) {
    try {
      const { data, error } = await sb
        .from("notification_preferences")
        .select("achievement_emails")
        .eq("user_id", uid)
        .maybeSingle();

      if (!error && data) {
        return { achievementEmails: data.achievement_emails !== false };
      }
    } catch (_) {}
  }

  return { achievementEmails: true };
}

async function updateUserNotificationPreferences(userId, preferences) {
  const uid = String(userId);
  const sb = getSupabase();
  const enabled = preferences.achievementEmails !== false;

  if (sb && sb.from) {
    try {
      await sb.from("notification_preferences").upsert({
        user_id: uid,
        achievement_emails: enabled,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    } catch (_) {}
  }

  return { achievementEmails: enabled };
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
