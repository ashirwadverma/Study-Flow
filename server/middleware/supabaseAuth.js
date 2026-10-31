const {
  supabase,
  createScopedClient,
  isConfigured,
} = require("../config/supabase");

// =====================================================
// SUPABASE AUTHENTICATION MIDDLEWARE
// =====================================================

async function requireSupabaseAuth(req, res, next) {
  try {
    // 1. Check configuration
    if (!isConfigured || !supabase) {
      return res.status(500).json({
        success: false,
        message: "Supabase is not configured. Check your .env file.",
      });
    }

    // 2. Extract access token
    let token = null;

    const authHeader = req.headers.authorization;

    if (authHeader && typeof authHeader === "string") {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);

      if (match) {
        token = match[1].trim();
      }
    }

    if (!token && req.headers["x-auth-token"]) {
      token = String(req.headers["x-auth-token"]).trim();
    }

    if (!token && req.cookies?.sb_access_token) {
      token = String(req.cookies.sb_access_token).trim();
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in again.",
      });
    }

    // 3. Verify Supabase access token
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired Supabase access token.",
      });
    }

    const sbUser = data.user;

    if (!sbUser.id) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user ID is missing.",
      });
    }

    // 4. Create authenticated, user-scoped Supabase client.
    // IMPORTANT: createScopedClient is ASYNC, so await is required.

    const scopedClient = await createScopedClient(token);

    // 5. Validate actual Supabase client
    if (
      !scopedClient ||
      typeof scopedClient.from !== "function" ||
      !scopedClient.auth
    ) {
      console.error("Invalid Supabase client returned.");

      return res.status(500).json({
        success: false,
        message: "Supabase client initialization failed.",
        code: "INVALID_SUPABASE_CLIENT",
      });
    }

    // 6. Get user information
    const userName =
      sbUser.user_metadata?.name ||
      sbUser.user_metadata?.full_name ||
      sbUser.email?.split("@")[0] ||
      "Student";

    const isEmailVerified = Boolean(
      sbUser.email_confirmed_at || sbUser.confirmed_at,
    );

    // 7. Attach authenticated user to request
    req.supabaseUser = sbUser;

    req.supabaseClient = scopedClient;

    req.supabase = scopedClient;

    req.userId = sbUser.id;

    req.supabaseUserId = sbUser.id;

    req.user = {
      id: sbUser.id,
      _id: sbUser.id,
      email: sbUser.email || null,
      name: userName,
      isVerified: isEmailVerified,
    };

    // 8. Continue to route
    return next();
  } catch (error) {
    console.error("Supabase authentication middleware error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error during authentication.",
      code: "SUPABASE_AUTH_ERROR",
    });
  }
}

// =====================================================
// EXPORT
// =====================================================

module.exports = {
  requireSupabaseAuth,
};
