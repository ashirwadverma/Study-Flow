const crypto = require("crypto");

const TOKEN_SECRET =
  process.env.SESSION_SECRET ||
  process.env.JWT_SECRET ||
  "studyflow_ultra_secure_token_secret_permanent_2026";

/**
 * Creates a signed, base64url-encoded auth token with HMAC-SHA256 signature.
 * Long-lived default (10 years) to keep user logged in until explicit logout.
 */
function generateAuthToken(userId, email, options = {}) {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const payload = {
    userId: String(userId),
    email: String(email).toLowerCase(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (options.expiresInSeconds || 10 * 365 * 24 * 60 * 60), // 10 years
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const signature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verifies the signed auth token.
 * Returns payload object if valid, or null if invalid/tampered/expired.
 */
function verifyAuthToken(token) {
  if (!token || typeof token !== "string") return null;

  try {
    const parts = token.trim().split(".");
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;

    // Verify HMAC signature
    const expectedSignature = crypto
      .createHmac("sha256", TOKEN_SECRET)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");

    // Timing-safe comparison to prevent timing attacks
    if (
      signature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      return null;
    }

    // Parse payload
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

    // Check expiration if present
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Extracts token from Request headers, cookies, or query params.
 */
function extractTokenFromRequest(req) {
  if (!req) return null;

  // 1. Authorization header (Bearer <token>)
  const authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (authHeader && typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    if (!authHeader.startsWith(" ")) {
      return authHeader.trim();
    }
  }

  // 2. Custom header (x-auth-token)
  if (req.headers && req.headers["x-auth-token"]) {
    return String(req.headers["x-auth-token"]).trim();
  }

  // 3. Cookies
  if (req.cookies && req.cookies.studyflow_auth_token) {
    return String(req.cookies.studyflow_auth_token).trim();
  }

  // 4. Raw Cookie header fallback if cookie-parser wasn't used
  if (req.headers && req.headers.cookie) {
    const cookies = req.headers.cookie.split(";");
    for (const cookie of cookies) {
      const parts = cookie.split("=");
      if (parts.length >= 2 && parts[0].trim() === "studyflow_auth_token") {
        return decodeURIComponent(parts.slice(1).join("=").trim());
      }
    }
  }

  return null;
}

module.exports = {
  generateAuthToken,
  verifyAuthToken,
  extractTokenFromRequest,
};
