const crypto = require("crypto");
const validator = require("validator");
const db = require("../services/dbAdapter");
const { sendVerificationEmail } = require("../services/emailService");
const { generateAuthToken, verifyAuthToken, extractTokenFromRequest } = require("../utils/tokenUtil");

// Validate password complexity
function validatePassword(password) {
  if (!password || typeof password !== "string") {
    return "Password is required.";
  }
  if (password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (password.length > 128) {
    return "Password must not exceed 128 characters.";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter.";
  }
  if (!/\d/.test(password)) {
    return "Password must contain at least one number.";
  }
  return null;
}

// ─── POST /api/auth/signup ──────────────────────────────────
async function signup(req, res) {
  try {
    const { name, email, password, confirmPassword } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Name is required." });
    }
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 60) {
      return res.status(400).json({ success: false, message: "Name must be between 2 and 60 characters." });
    }

    if (!email || !validator.isEmail(email.trim())) {
      return res.status(400).json({ success: false, message: "Please provide a valid email address." });
    }
    const cleanEmail = email.trim().toLowerCase();

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ success: false, message: passwordError });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: "Passwords do not match." });
    }

    // Check for existing user
    const existingUser = await db.findUserByEmail(cleanEmail, true);

    if (existingUser) {
      if (existingUser.isVerified) {
        return res.status(409).json({
          success: false,
          message: "An account with this email address already exists. Please log in.",
        });
      }

      // Existing unverified user: re-issue verification token
      const newToken = crypto.randomBytes(32).toString("hex");
      existingUser.name = cleanName;
      existingUser.password = password;
      existingUser.verificationToken = newToken;
      existingUser.verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await existingUser.save();

      const emailResult = await sendVerificationEmail({
        email: existingUser.email,
        name: existingUser.name,
        token: newToken,
      });

      return res.status(200).json({
        success: true,
        message: "An unverified account exists. A fresh verification link has been sent to your email.",
        email: existingUser.email,
        devLink: emailResult.devLink || null,
      });
    }

    // Generate secure random single-use verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const newUser = await db.createUser({
      name: cleanName,
      email: cleanEmail,
      password: password,
      verificationToken,
      verificationTokenExpires,
    });

    const emailResult = await sendVerificationEmail({
      email: newUser.email,
      name: newUser.name,
      token: verificationToken,
    });

    return res.status(201).json({
      success: true,
      message: "Account created successfully! Please check your email to verify your account before logging in.",
      email: newUser.email,
      devLink: emailResult.devLink || null,
    });
  } catch (error) {
    console.error("Signup error:", error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }
    return res.status(500).json({
      success: false,
      message: "An error occurred while creating your account. Please try again.",
    });
  }
}

// ─── GET /api/auth/verify-email ─────────────────────────────
async function verifyEmail(req, res) {
  try {
    const token = (req.query.token || req.params.token || "").trim();

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Verification token is missing.",
      });
    }

    // Find user with this token
    const user = await db.findUserByVerificationToken(token);

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or already used verification token. If your account is not verified, please request a new link.",
      });
    }

    // Check expiry
    if (user.verificationTokenExpires && new Date(user.verificationTokenExpires) < new Date()) {
      return res.status(400).json({
        success: false,
        expired: true,
        email: user.email,
        message: "This verification link has expired. Please request a new verification email.",
      });
    }

    // Mark as verified and invalidate token to prevent reuse
    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    console.log(`✓ Email verified successfully for user: ${user.email}`);

    return res.status(200).json({
      success: true,
      message: "Your email has been successfully verified! You can now log in to your account.",
      email: user.email,
    });
  } catch (error) {
    console.error("verifyEmail error:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while verifying your email.",
    });
  }
}

// ─── POST /api/auth/resend-verification ─────────────────────
async function resendVerification(req, res) {
  try {
    const { email } = req.body || {};

    if (!email || !validator.isEmail(email.trim())) {
      return res.status(400).json({ success: false, message: "Please provide a valid email address." });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await db.findUserByEmail(cleanEmail, true);

    if (!user) {
      // Return 200 without exposing whether account exists
      return res.status(200).json({
        success: true,
        message: "If an unverified account with this email exists, a fresh verification link has been sent.",
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "This account has already been verified. You can log in directly.",
      });
    }

    const newToken = crypto.randomBytes(32).toString("hex");
    user.verificationToken = newToken;
    user.verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    const emailResult = await sendVerificationEmail({
      email: user.email,
      name: user.name,
      token: newToken,
    });

    return res.status(200).json({
      success: true,
      message: "A fresh verification link has been sent to your email address.",
      email: user.email,
      devLink: emailResult.devLink || null,
    });
  } catch (error) {
    console.error("resendVerification error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to resend verification email. Please try again.",
    });
  }
}

// ─── POST /api/auth/login ───────────────────────────────────
async function login(req, res) {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide both email and password.",
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await db.findUserByEmail(cleanEmail, true);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        unverified: true,
        email: user.email,
        message: "Your email address is not verified yet. Please check your email for the verification link.",
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    const uid = (user._id || user.id).toString();

    // Create session
    req.session.userId = uid;
    req.session.userEmail = user.email;

    // Generate permanent 10-year auth token
    const authToken = generateAuthToken(uid, user.email);

    // Set permanent 10-year cookie
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("studyflow_auth_token", authToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 3650 * 24 * 60 * 60 * 1000, // 10 years
      path: "/",
    });

    const safeUser = typeof user.toSafeObject === "function" ? user.toSafeObject() : { id: uid, _id: uid, name: user.name, email: user.email };

    return res.status(200).json({
      success: true,
      message: "Logged in successfully!",
      token: authToken,
      user: safeUser,
    });
  } catch (error) {
    console.error("login error:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred during login. Please try again.",
    });
  }
}

// ─── POST /api/auth/logout ──────────────────────────────────
function logout(req, res) {
  try {
    if (req.session) {
      req.session.destroy(() => {});
    }
    res.clearCookie("studyflow.sid", { path: "/" });
    res.clearCookie("studyflow_auth_token", { path: "/" });
    return res.status(200).json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (error) {
    console.error("logout error:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred during logout.",
    });
  }
}

// ─── GET /api/auth/me ───────────────────────────────────────
async function getMe(req, res) {
  try {
    let userId = req.session && req.session.userId;
    let user = null;

    if (userId) {
      user = await db.findUserById(userId);
    }

    // Auto-recover session from persistent token if session was lost/restarted
    if (!user) {
      const rawToken = extractTokenFromRequest(req);
      if (rawToken) {
        const payload = verifyAuthToken(rawToken);
        if (payload && payload.userId) {
          user = await db.findUserById(payload.userId);
          if (user) {
            req.session = req.session || {};
            req.session.userId = (user._id || user.id).toString();
            req.session.userEmail = user.email;
          }
        }
      }
    }

    if (!user || !user.isVerified) {
      if (req.session && typeof req.session.destroy === "function") {
        req.session.destroy(() => {});
      }
      return res.status(200).json({
        success: true,
        authenticated: false,
        user: null,
      });
    }

    const safeUser = typeof user.toSafeObject === "function" ? user.toSafeObject() : { id: user.id || user._id, _id: user.id || user._id, name: user.name, email: user.email };
    const authToken = generateAuthToken(safeUser._id || safeUser.id, safeUser.email);

    return res.status(200).json({
      success: true,
      authenticated: true,
      token: authToken,
      user: safeUser,
    });
  } catch (error) {
    console.error("getMe error:", error);
    return res.status(500).json({
      success: false,
      authenticated: false,
      user: null,
      message: "Error fetching user status.",
    });
  }
}

module.exports = {
  signup,
  verifyEmail,
  resendVerification,
  login,
  logout,
  getMe,
};
