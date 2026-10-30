/**
 * js/supabaseClient.js
 * Browser Supabase Client Initialization for StudyFlow
 *
 * Configured with publishable credentials loaded from /js/supabase-config.js.
 * Handles session persistence and automatic token refreshment.
 */

(function () {
  let clientPromise = null;

  function createClientFromConfig(config) {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.error('Supabase JS library is not loaded on window.');
      return null;
    }

    const url = (config && config.url) ? config.url.trim() : '';
    const key = (config && config.publishableKey) ? config.publishableKey.trim() : '';

    if (!url || !key) {
      console.warn('Supabase URL or Publishable Key is missing from window.SUPABASE_CONFIG.');
      return null;
    }

    const client = window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
      },
    });

    window.supabaseClient = client;

    // Listen for authentication state changes and keep localStorage in sync
    client.auth.onAuthStateChange((event, session) => {
      try {
        if (session && session.user) {
          const userObj = {
            id: session.user.id,
            _id: session.user.id,
            email: session.user.email,
            name:
              (session.user.user_metadata && (session.user.user_metadata.name || session.user.user_metadata.full_name)) ||
              (session.user.email ? session.user.email.split('@')[0] : 'Student'),
            isVerified: Boolean(session.user.email_confirmed_at || session.user.confirmed_at || true),
          };
          localStorage.setItem('studyflow_auth_token', session.access_token);
          localStorage.setItem('studyflow_auth_user', JSON.stringify(userObj));
        } else if (event === 'SIGNED_OUT') {
          localStorage.removeItem('studyflow_auth_token');
          localStorage.removeItem('studyflow_auth_user');
        }
      } catch (err) {
        console.warn('onAuthStateChange sync notice:', err);
      }
    });

    return client;
  }

  window.getSupabaseClient = async function () {
    if (window.supabaseClient) {
      return window.supabaseClient;
    }

    if (clientPromise) {
      return clientPromise;
    }

    clientPromise = (async () => {
      // 1. If config already available synchronously
      if (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.publishableKey) {
        return createClientFromConfig(window.SUPABASE_CONFIG);
      }

      // 2. Fetch config from server endpoint if not loaded yet
      try {
        const apiBase = (typeof window !== 'undefined' && (window.location.protocol === 'file:' || (window.location.port && window.location.port !== '5000')))
          ? 'http://localhost:5000'
          : '';
        const res = await fetch(`${apiBase}/api/config/supabase`);
        if (res.ok) {
          const data = await res.json();
          window.SUPABASE_CONFIG = {
            url: data.supabaseUrl,
            publishableKey: data.supabasePublishableKey,
          };
          return createClientFromConfig(window.SUPABASE_CONFIG);
        }
      } catch (e) {
        console.warn('Could not fetch Supabase configuration from /api/config/supabase:', e.message);
      }

      return null;
    })();

    return clientPromise;
  };

  // Immediate init if script loaded after config
  if (typeof window !== 'undefined' && window.SUPABASE_CONFIG && window.supabase) {
    createClientFromConfig(window.SUPABASE_CONFIG);
  }
})();

