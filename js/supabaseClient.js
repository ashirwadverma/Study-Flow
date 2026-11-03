/**
 * js/supabaseClient.js
 * Browser Supabase Client Initialization for StudyFlow
 *
 * Configured with publishable credentials loaded from ./js/supabase-config.js
 * with automatic fallback to local vendor bundle, synchronous instantiation,
 * and robust retry mechanisms.
 */

(function () {
  const FALLBACK_CONFIG = {
    url: "https://wunghwovfpwbwforqeaq.supabase.co",
    publishableKey: "sb_publishable_7N7nid5nIBmgcD8N1zmfng_ohYSrKrd",
  };

  let clientPromise = null;

  async function ensureSupabaseLibrary(timeoutMs = 5000) {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      return window.supabase;
    }

    // Try dynamically loading local vendor bundle first without unnecessary delay
    if (!window.supabase) {
      await new Promise(resolve => {
        const script = document.createElement('script');
        script.src = './vendor/supabase/supabase.js';
        script.onload = () => resolve();
        script.onerror = () => resolve();
        document.head.appendChild(script);
      });
    }

    if (window.supabase && typeof window.supabase.createClient === 'function') {
      return window.supabase;
    }

    // Try CDN if vendor bundle wasn't immediately ready
    await new Promise(resolve => {
      const cdn = document.createElement('script');
      cdn.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      cdn.onload = () => resolve();
      cdn.onerror = () => resolve();
      document.head.appendChild(cdn);
    });

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        return window.supabase;
      }
      await new Promise(r => setTimeout(r, 60));
    }

    return (window.supabase && typeof window.supabase.createClient === 'function') ? window.supabase : null;
  }

  function createClientFromConfig(config) {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      return null;
    }

    const url = (config && config.url) ? config.url.trim() : FALLBACK_CONFIG.url;
    const key = (config && (config.publishableKey || config.anonKey))
      ? (config.publishableKey || config.anonKey).trim()
      : FALLBACK_CONFIG.publishableKey;

    if (!url || !key) {
      console.warn('Supabase URL or Publishable Key is missing.');
      return null;
    }

    try {
      const storageObj = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : undefined;
      const client = window.supabase.createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: storageObj,
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
            if (storageObj) {
              storageObj.setItem('studyflow_auth_token', session.access_token);
              storageObj.setItem('studyflow_auth_user', JSON.stringify(userObj));
            }
          } else if (event === 'SIGNED_OUT') {
            if (storageObj) {
              storageObj.removeItem('studyflow_auth_token');
              storageObj.removeItem('studyflow_auth_user');
            }
          }
        } catch (err) {
          console.warn('onAuthStateChange sync notice:', err);
        }
      });

      return client;
    } catch (e) {
      console.error('Error creating Supabase client:', e);
      return null;
    }
  }

  // Attempt synchronous initialization immediately if SDK is available
  if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
    createClientFromConfig(window.SUPABASE_CONFIG || FALLBACK_CONFIG);
  }

  window.getSupabaseClient = async function () {
    if (window.supabaseClient) {
      return window.supabaseClient;
    }

    // Direct synchronous check
    if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
      const client = createClientFromConfig(window.SUPABASE_CONFIG || FALLBACK_CONFIG);
      if (client) return client;
    }

    if (clientPromise) {
      const res = await clientPromise;
      if (res) return res;
      clientPromise = null;
    }

    clientPromise = (async () => {
      // 1. Ensure Supabase JS SDK is ready
      await ensureSupabaseLibrary();

      // 2. Try window.SUPABASE_CONFIG if available
      if (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.publishableKey) {
        const client = createClientFromConfig(window.SUPABASE_CONFIG);
        if (client) return client;
      }

      // 3. Try fallback configuration
      const fallbackClient = createClientFromConfig(FALLBACK_CONFIG);
      if (fallbackClient) {
        window.SUPABASE_CONFIG = FALLBACK_CONFIG;
        return fallbackClient;
      }

      // 4. Fetch config from server endpoint as last resort
      try {
        const configUrl = (typeof window.getStudyFlowApiUrl === 'function')
          ? window.getStudyFlowApiUrl('/api/config/supabase')
          : '/api/config/supabase';
        const res = await fetch(configUrl);
        if (res.ok) {
          const rawText = await res.text().catch(() => '');
          let data = null;
          try { data = JSON.parse(rawText); } catch (_) {}
          if (data) {
            window.SUPABASE_CONFIG = {
              url: data.supabaseUrl || FALLBACK_CONFIG.url,
              publishableKey: data.supabasePublishableKey || FALLBACK_CONFIG.publishableKey,
            };
            const serverClient = createClientFromConfig(window.SUPABASE_CONFIG);
            if (serverClient) return serverClient;
          }
        }
      } catch (e) {
        console.warn('Could not fetch Supabase configuration from /api/config/supabase:', e.message);
      }

      return null;
    })();

    const result = await clientPromise;
    if (!result) {
      clientPromise = null;
    }
    return result;
  };

  // Immediate eager initialization
  if (typeof window !== 'undefined') {
    window.getSupabaseClient().catch(err => console.debug('Eager Supabase init note:', err));
  }
})();
