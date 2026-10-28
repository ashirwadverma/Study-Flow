const express = require("express");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");
const session = require("express-session");
const MongoStore = require("connect-mongo");

dotenv.config();

const { connectDB } = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const studyDataRoutes = require("./routes/studyDataRoutes");
const syllabusRoutes = require("./routes/syllabusRoutes");
const pyqRoutes = require("./routes/pyqRoutes");
const {
  topicRouter,
  updateNotificationPreferences,
  getNotifications,
  recordPYQPractice,
} = require("./routes/assessmentRoutes");
const { requireAuth } = require("./middleware/authMiddleware");

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === "production";
const mongoURI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/syllabus_study_planner";

// Connect to MongoDB
connectDB();

// Trust proxy for secure cookies behind reverse proxies (Heroku, Render, Nginx)
if (isProduction) {
  app.set("trust proxy", 1);
}

// CORS & Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

const { extractTokenFromRequest, verifyAuthToken } = require("./utils/tokenUtil");
const db = require("./services/dbAdapter");

// Lightweight cookie parsing middleware
app.use((req, res, next) => {
  req.cookies = {};
  if (req.headers && req.headers.cookie) {
    const rawCookies = req.headers.cookie.split(";");
    for (const c of rawCookies) {
      const parts = c.split("=");
      if (parts.length >= 2) {
        req.cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join("=").trim());
      }
    }
  }
  next();
});

// Session Store Configuration - 10 years persistence
let sessionStore = undefined;
try {
  const StoreClass = MongoStore.MongoStore || MongoStore.default || MongoStore;
  if (StoreClass && typeof StoreClass.create === "function" && process.env.MONGODB_URI) {
    sessionStore = StoreClass.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: "sessions",
      ttl: 3650 * 24 * 60 * 60, // 10 years in seconds
      autoRemove: "native",
      touchAfter: 24 * 3600,
    });
    console.log("✓ MongoStore session persistence configured with MongoDB Atlas (10-year retention)");
  }
} catch (err) {
  console.warn("Session store notice:", err.message);
}

// Session Middleware (10-year cookie maxAge)
app.use(
  session({
    name: "studyflow.sid",
    secret: process.env.SESSION_SECRET || "studyflow_secure_session_secret_change_in_production_2026",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 3650 * 24 * 60 * 60 * 1000, // 10 years (stay logged in permanently)
    },
  })
);

// Automatic Session Rehydration Middleware
// If session was lost (e.g. server restart, memory flush), rehydrate from signed auth token
app.use(async (req, res, next) => {
  try {
    if (!req.session || !req.session.userId) {
      const rawToken = extractTokenFromRequest(req);
      if (rawToken) {
        const payload = verifyAuthToken(rawToken);
        if (payload && payload.userId) {
          const user = await db.findUserById(payload.userId);
          if (user && user.isVerified) {
            req.session = req.session || {};
            req.session.userId = (user._id || user.id).toString();
            req.session.userEmail = user.email;
            req.user = typeof user.toSafeObject === "function" ? user.toSafeObject() : { id: user.id, name: user.name, email: user.email };
          }
        }
      }
    }
  } catch (err) {
    console.warn("Auto rehydration notice:", err.message);
  }
  next();
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/user", studyDataRoutes);
app.use("/api/syllabus", syllabusRoutes);
app.use("/api/pyq", pyqRoutes);
app.use("/api/topics", topicRouter);
app.patch("/api/settings/notifications", requireAuth, updateNotificationPreferences);
app.get("/api/notifications", requireAuth, getNotifications);
app.post("/api/pyq-sets/:setId/attempts", requireAuth, (req, res, next) => {
  req.params.topicId = req.params.setId;
  recordPYQPractice(req, res, next);
});

// Health check route
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Syllabus Study Planner API is running",
    timestamp: new Date().toISOString(),
  });
});

// Serve frontend static assets
app.use(express.static(path.join(__dirname, "..")));

// Global error handler
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  console.error("Express global error handler:", error);
  res.status(error.status || 500).json({
    success: false,
    message: error.message || "Something went wrong while processing your request.",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✓ Server running at http://localhost:${PORT}`);
});
