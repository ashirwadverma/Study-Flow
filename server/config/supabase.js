const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");
const path = require("path");

// Load .env from the project root
dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in root .env",
  );
}

// Base client: used for verifying access tokens
const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

/**
 * Verify the user's Supabase access token.
 *
 * Returns the authenticated user if valid.
 * Throws an error if the token is invalid or expired.
 */
async function verifyAccessToken(accessToken) {
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Access token is required.");
  }

  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data?.user) {
    throw new Error("Invalid or expired access token.");
  }

  return data.user;
}

/**
 * Verify the token and create a user-scoped client.
 *
 * The returned client sends the user's JWT to Supabase.
 * RLS policies will therefore apply to that authenticated user.
 */
async function createAuthenticatedClient(accessToken) {
  // Step 1: Verify identity
  const user = await verifyAccessToken(accessToken);

  // Step 2: Create a client scoped to the verified user's JWT
  const client = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  return {
    client,
    user,
  };
}

// Keep compatibility with existing imports.
// This function also verifies the token before returning a client.
async function createScopedClient(accessToken) {
  const { client } = await createAuthenticatedClient(accessToken);
  return client;
}

function getSupabaseClient() {
  return supabase;
}

module.exports = {
  supabase,
  getSupabaseClient,
  verifyAccessToken,
  createAuthenticatedClient,
  createScopedClient,
  isConfigured: true,
};
