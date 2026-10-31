const express = require("express");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const app = express();

const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === "production";

// =====================================================
// 1. DATABASE CONFIGURATION
// =====================================================

// Existing database adapter (local JSON / legacy storage)
const db = require("./services/dbAdapter");

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

// Validate Supabase configuration
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "WARNING: Supabase configuration is missing. Check your .env file.",
  );
} else {
  console.log("Supabase configuration found.");
}

// =====================================================
// 2. MONGODB (OPTIONAL LEGACY DATABASE)
// =====================================================

const { connectDB } = require("./config/db");

if (process.env.MONGODB_URI) {
  connectDB().catch((err) => {
    console.warn("MongoDB connection notice:", err.message);
  });
} else {
  console.log("MongoDB not configured. Using available local storage.");
}

// =====================================================
// 3. ERROR HANDLING
// =====================================================

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

// =====================================================
// 4. CORS AND BODY PARSING
// =====================================================

app.set("trust proxy", isProduction ? 1 : false);

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// =====================================================
// 5. COOKIE PARSING
// =====================================================

app.use((req, res, next) => {
  req.cookies = {};

  const rawCookies = req.headers.cookie;

  if (rawCookies) {
    rawCookies.split(";").forEach((cookie) => {
      const parts = cookie.split("=");

      if (parts.length >= 2) {
        req.cookies[parts[0].trim()] = decodeURIComponent(
          parts.slice(1).join("=").trim(),
        );
      }
    });
  }

  next();
});

// =====================================================
// 6. SUPABASE CLIENT MIDDLEWARE
// =====================================================

// IMPORTANT:
// This creates a REAL Supabase client for every request.
// It attaches that client to req.supabaseClient.
// This fixes the missing .from() function problem
// when the routes use req.supabaseClient.from(...).

app.use((req, res, next) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      req.supabaseClient = null;
      return next();
    }

    const authorization = req.headers.authorization;

    const headers = {};

    // Forward a Supabase user access token when supplied.
    // This allows Supabase Row Level Security to identify
    // the authenticated user.
    if (authorization && authorization.startsWith("Bearer ")) {
      headers.Authorization = authorization;
    }

    req.supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers,
      },
    });

    next();
  } catch (error) {
    console.error("Supabase client initialization error:", error);

    req.supabaseClient = null;

    next();
  }
});

// =====================================================
// 7. SESSION STORE CONFIGURATION
// =====================================================

let sessionStore;

try {
  const StoreClass = MongoStore.MongoStore || MongoStore.default || MongoStore;

  const mongoURI = process.env.MONGODB_URI;

  if (
    mongoURI &&
    typeof StoreClass.create === "function" &&
    mongoURI.includes("mongodb+srv://")
  ) {
    sessionStore = StoreClass.create({
      mongoUrl: mongoURI,
      collectionName: "sessions",
      ttl: 3650 * 24 * 60 * 60,
      autoRemove: "native",
      touchAfter: 24 * 3600,
    });

    sessionStore.on("error", (err) => {
      console.warn("Session store notice:", err.message);
    });

    console.log("MongoDB Atlas session store configured.");
  } else {
    console.log("Session store using in-memory persistence (local mode).");
  }
} catch (error) {
  console.warn("Session store initialization notice:", error.message);
}

// =====================================================
// 8. EXPRESS SESSION
// =====================================================

const sessionConfig = {
  name: "studyflow.sid",

  secret:
    process.env.SESSION_SECRET ||
    "studyflow_secure_session_secret_change_in_production_2026",

  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 3650 * 24 * 60 * 60 * 1000,
  },
};

if (sessionStore) {
  sessionConfig.store = sessionStore;
}

app.use(session(sessionConfig));

// =====================================================
// 9. AUTHENTICATION AND SESSION REHYDRATION
// =====================================================

const {
  extractTokenFromRequest,
  verifyAuthToken,
} = require("./utils/tokenUtil");

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

            req.user =
              typeof user.toSafeObject === "function"
                ? user.toSafeObject()
                : {
                    id: user._id || user.id,
                    name: user.name,
                    email: user.email,
                  };
          }
        }
      }
    }
  } catch (error) {
    console.warn("Auto rehydration notice:", error.message);
  }

  next();
});

// =====================================================
// 10. IMPORT API ROUTES
// =====================================================

const authRoutes = require("./routes/authRoutes");

const studyDataRoutes = require("./routes/studyDataRoutes");

const syllabusRoutes = require("./routes/syllabusRoutes");

const pyqRoutes = require("./routes/pyqRoutes");

const subjectRoutes = require("./routes/subjectRoutes");

const {
  topicRouter,
  updateNotificationPreferences,
  getNotifications,
  recordPYQPractice,
} = require("./routes/assessmentRoutes");

const { requireAuth } = require("./middleware/authMiddleware");

// =====================================================
// 11. REGISTER API ROUTES
// =====================================================

app.use("/api/auth", authRoutes);

app.use("/api/user", studyDataRoutes);

app.use("/api/subjects", subjectRoutes);

app.use("/api/syllabus", syllabusRoutes);

app.use("/api/pyq", pyqRoutes);

app.use("/api/topics", topicRouter);

app.patch(
  "/api/settings/notifications",
  requireAuth,
  updateNotificationPreferences,
);

app.get("/api/notifications", requireAuth, getNotifications);

app.post("/api/pyq-sets/:setId/attempts", requireAuth, (req, res, next) => {
  req.params.topicId = req.params.setId;

  recordPYQPractice(req, res, next);
});

// =====================================================
// 12. FRONTEND SUPABASE CONFIGURATION
// =====================================================

// Public configuration only.
// NEVER expose your Supabase secret/service_role key.

app.get("/js/supabase-config.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");

  res.send(`
    window.SUPABASE_CONFIG = {
      url: ${JSON.stringify(SUPABASE_URL || "")},
      publishableKey: ${JSON.stringify(SUPABASE_KEY || "")}
    };
  `);
});

app.get("/api/config/supabase", (req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL || "",
    supabasePublishableKey: SUPABASE_KEY || "",
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
  });
});

// =====================================================
// 13. HEALTH CHECK
// =====================================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Syllabus Study Planner API is running",
    supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    timestamp: new Date().toISOString(),
  });
});

// =====================================================
// 14. FRONTEND STATIC FILES
// =====================================================

app.use(express.static(path.join(__dirname, "..")));

// =====================================================
// 15. GLOBAL ERROR HANDLER
// =====================================================

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  console.error("Express global error handler:", error);

  res.status(error.status || 500).json({
    success: false,
    message:
      error.message || "Something went wrong while processing your request.",
  });
});

// =====================================================
// 16. START SERVER
// =====================================================

const server = app.listen(PORT, () => {
  console.log("---------------------------------------");
  console.log("Syllabus Study Planner Server Started");
  console.log("---------------------------------------");

  console.log(`Server: http://localhost:${PORT}`);

  console.log(
    "Supabase:",
    SUPABASE_URL && SUPABASE_KEY ? "Configuration loaded" : "Not configured",
  );

  console.log("---------------------------------------");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already being used.`);
  } else {
    console.error("Server error:", err);
  }
});

module.exports = app;
