const db = require("../services/dbAdapter");
const { extractTokenFromRequest, verifyAuthToken } = require("../utils/tokenUtil");

async function requireAuth(req, res, next) {
  try {
    let userId = req.session && req.session.userId;
    let user = null;

    // 1. Try finding user from active session
    if (userId) {
      user = await db.findUserById(userId);
    }

    // 2. If no session user found, attempt token recovery from headers/cookies
    if (!user) {
      const rawToken = extractTokenFromRequest(req);
      if (rawToken) {
        const payload = verifyAuthToken(rawToken);
        if (payload && payload.userId) {
          user = await db.findUserById(payload.userId);
          if (user) {
            // Rehydrate session
            req.session = req.session || {};
            req.session.userId = (user._id || user.id).toString();
            req.session.userEmail = user.email;
          }
        }
      }
    }

    // 3. If still no user, reject
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in to access this resource.",
      });
    }

    // 4. Check verification status
    if (!user.isVerified) {
      if (req.session && typeof req.session.destroy === "function") {
        req.session.destroy(() => {});
      }
      return res.status(403).json({
        success: false,
        message: "Your email address is unverified. Please verify your email first.",
      });
    }

    req.user =
      typeof user.toSafeObject === "function"
        ? user.toSafeObject()
        : { id: user.id || user._id, name: user.name, email: user.email };

    next();
  } catch (error) {
    console.error("requireAuth error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal authentication error.",
    });
  }
}

module.exports = {
  requireAuth,
};
