const {
  createAuthenticatedClient,
  isConfigured,
} = require("../config/supabase");

const db = require("../services/dbAdapter");
const { extractTokenFromRequest } = require("../utils/tokenUtil");

async function requireAuth(req, res, next) {
  try {
    // 1. Ensure Supabase is configured
    if (!isConfigured) {
      return res.status(503).json({
        success: false,
        message: "Authentication service is not configured.",
      });
    }

    // 2. Extract Bearer token from request
    const accessToken = extractTokenFromRequest(req);

    if (!accessToken) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in.",
      });
    }

    // 3. Verify token and create authenticated client
    let authResult;

    try {
      authResult = await createAuthenticatedClient(accessToken);
    } catch (authError) {
      console.warn("Supabase authentication failed:", authError.message);

      return res.status(401).json({
        success: false,
        message:
          "Invalid or expired authentication token. Please log in again.",
      });
    }

    const { client, user: sbUser } = authResult;

    // 4. Get identity only from the verified Supabase user
    const userId = sbUser.id;

    const userName =
      sbUser.user_metadata?.name ||
      sbUser.user_metadata?.full_name ||
      (sbUser.email ? sbUser.email.split("@")[0] : "Student");

    // 5. Attach authenticated information to request
    req.supabaseUser = sbUser;
    req.supabaseClient = client;
    req.userId = userId;

    req.user = {
      id: userId,
      _id: userId,
      email: sbUser.email,
      name: userName,
      emailConfirmed: Boolean(sbUser.email_confirmed_at || sbUser.confirmed_at),
    };

    // 6. Optional: Sync user with existing local database
    // Supabase remains the authentication authority.
    try {
      const existing = await db.findUserById(userId);

      if (!existing) {
        await db.createUser({
          id: userId,
          name: userName,
          email: sbUser.email,
        });
      }
    } catch (dbError) {
      console.warn("Local user sync skipped:", dbError.message);
    }

    // 7. Continue to protected route
    return next();
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
