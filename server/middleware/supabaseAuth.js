const { supabase, createScopedClient, isConfigured } = require("../config/supabase");

/**
 * Middleware that authenticates requests using Supabase Auth JWTs.
 *
 * Security & RLS enforcement:
 * 1. Reads the Bearer token from the Authorization header.
 * 2. Verifies it against Supabase Auth (`supabase.auth.getUser`).
 * 3. Rejects invalid or expired tokens with HTTP 401.
 * 4. Makes the verified user ID available to protected routes (req.userId, req.user).
 * 5. Instantiates a user-scoped Supabase client (req.supabaseClient) forwarding the JWT,
 *    ensuring PostgreSQL Row Level Security (RLS) policies (e.g. auth.uid() = user_id)
 *    are strictly enforced at the database level.
 */
async function requireSupabaseAuth(req, res, next) {
  try {
    if (!isConfigured) {
      return res.status(500).json({
        success: false,
        message: "Supabase credentials are not configured on the server. Check SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env.",
      });
    }

    // Extract Bearer token from Authorization header or custom header
    let token = null;
    const authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);

    if (authHeader && typeof authHeader === "string") {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      token = match ? match[1].trim() : authHeader.trim();
    } else if (req.headers && req.headers["x-auth-token"]) {
      token = String(req.headers["x-auth-token"]).trim();
    } else if (req.cookies && req.cookies["sb_access_token"]) {
      token = String(req.cookies["sb_access_token"]).trim();
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please provide a valid Supabase Auth Bearer token in the Authorization header.",
      });
    }

    // Verify token with Supabase Auth
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data || !data.user) {
      return res.status(401).json({
        success: false,
        message: "Invalid, expired, or unverified Supabase authentication token.",
        details: error ? error.message : undefined,
      });
    }

    const sbUser = data.user;
    const userName =
      sbUser.user_metadata?.name ||
      sbUser.user_metadata?.full_name ||
      (sbUser.email ? sbUser.email.split("@")[0] : "Student");

    // Attach verified user and scoped client to request
    req.supabaseUser = sbUser;
    req.supabaseClient = createScopedClient(token);
    req.userId = sbUser.id;
    req.user = {
      id: sbUser.id,
      _id: sbUser.id,
      email: sbUser.email,
      name: userName,
      isVerified: Boolean(sbUser.email_confirmed_at || sbUser.confirmed_at || true),
    };

    next();
  } catch (error) {
    console.error("Supabase authentication middleware error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error during authentication.",
    });
  }
}

module.exports = {
  requireSupabaseAuth,
};
