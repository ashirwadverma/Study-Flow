/**
 * js/auth.js
 * Comprehensive client-side authentication manager for StudyFlow powered by Supabase Auth.
 *
 * Implements:
 * - Direct Supabase Auth (signUp, signInWithPassword, signOut)
 * - Automatic seamless backend fallback if client SDK is temporarily unavailable
 * - Session persistence across tabs and reloads
 * - State change synchronization
 * - Bearer token attachment via fetchWithAuth()
 */

const AUTH_STORAGE_KEY = 'studyflow_auth_user';
const AUTH_TOKEN_KEY = 'studyflow_auth_token';

const AuthManager = {
  // Get stored persistent auth token
  getToken() {
    try {
      return localStorage.getItem(AUTH_TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  },

  // Save persistent auth token
  setToken(token) {
    try {
      if (token) {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
      } else {
        localStorage.removeItem(AUTH_TOKEN_KEY);
      }
    } catch (e) {
      console.warn('Could not save auth token to localStorage:', e);
    }
  },

  // Get locally cached user profile
  getUser() {
    try {
      const user = localStorage.getItem(AUTH_STORAGE_KEY);
      return user ? JSON.parse(user) : null;
    } catch (e) {
      return null;
    }
  },

  // Internal helper to get or initialize the Supabase client
  async _getClient() {
    // 1. Direct active instance
    if (window.supabaseClient && window.supabaseClient.auth) {
      return window.supabaseClient;
    }

    // 2. Official resolver function
    if (typeof window.getSupabaseClient === 'function') {
      try {
        const client = await window.getSupabaseClient();
        if (client && client.auth) return client;
      } catch (e) {
        console.warn('getSupabaseClient notice:', e);
      }
    }

    // 3. Direct instantiation from window.supabase
    const config = window.SUPABASE_CONFIG || {
      url: "https://wunghwovfpwbwforqeaq.supabase.co",
      publishableKey: "sb_publishable_7N7nid5nIBmgcD8N1zmfng_ohYSrKrd",
    };

    if (window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        const storageObj = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : undefined;
        const client = window.supabase.createClient(config.url, config.publishableKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: storageObj,
          },
        });
        if (client && client.auth) {
          window.supabaseClient = client;
          return client;
        }
      } catch (err) {
        console.warn('Direct Supabase initialization notice:', err);
      }
    }

    return null;
  },

  // Internal helper to save Supabase session & user
  _saveSession(session, user, fallbackName = '') {
    if (!session || !user) return;
    const name =
      (user.user_metadata && (user.user_metadata.name || user.user_metadata.full_name)) ||
      fallbackName ||
      (user.email ? user.email.split('@')[0] : 'Student');

    const safeUser = {
      id: user.id,
      _id: user.id,
      email: user.email,
      name,
      isVerified: Boolean(user.email_confirmed_at || user.confirmed_at || true),
    };

    localStorage.setItem(AUTH_TOKEN_KEY, session.access_token);
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(safeUser));
  },

  // Internal helper to clear session and user state
  _clearSession() {
    const user = AuthManager.getUser();
    if (user) {
      const uid = user.id || user._id || user.email;
      if (uid) {
        localStorage.removeItem(`sf_user_${uid}_subjects`);
        localStorage.removeItem(`sf_user_${uid}_sessions`);
        localStorage.removeItem(`sf_user_${uid}_activity`);
        localStorage.removeItem(`sf_user_${uid}_notes`);
      }
    }
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem('sf_subjects');
    localStorage.removeItem('sf_sessions');
    localStorage.removeItem('sf_activity');
    localStorage.removeItem('sf_study_notes');
    localStorage.removeItem('ssp_syllabus');
    localStorage.removeItem('ssp_generated_plan');
    localStorage.removeItem('ssp_completed_sessions');
    localStorage.removeItem('ssp_session_activity');
    localStorage.removeItem('ssp_student_info');
    localStorage.removeItem('ssp_notes');
  },

  // Authenticated fetch wrapper that attaches Authorization: Bearer <access_token>
  async fetchWithAuth(url, options = {}) {
    let token = AuthManager.getToken();

    // If token is missing, attempt quick session retrieval from Supabase client
    if (!token) {
      try {
        const client = await AuthManager._getClient();
        if (client && client.auth) {
          const { data } = await client.auth.getSession();
          if (data && data.session && data.session.access_token) {
            token = data.session.access_token;
            AuthManager.setToken(token);
          }
        }
      } catch (e) {
        // Fall back to existing token value
      }
    }

    const headers = {
      ...(options.headers || {}),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-auth-token'] = token;
    }

    const fetchConfig = {
      ...options,
      headers,
      credentials: 'include',
    };

    const fullUrl = url.startsWith('http')
      ? url
      : (typeof window.getStudyFlowApiUrl === 'function'
          ? window.getStudyFlowApiUrl(url)
          : url);

    return fetch(fullUrl, fetchConfig);
  },

  // Check active session status via Supabase Auth
  async checkSession() {
    try {
      const client = await AuthManager._getClient();

      if (!client) {
        const cachedUser = AuthManager.getUser();
        if (cachedUser && AuthManager.getToken()) {
          return { authenticated: true, user: cachedUser, offline: true };
        }
        return { authenticated: false, user: null };
      }

      const { data, error } = await client.auth.getSession();
      if (error || !data || !data.session) {
        const cachedUser = AuthManager.getUser();
        if (cachedUser && AuthManager.getToken()) {
          return { authenticated: true, user: cachedUser, offline: true };
        }
        return { authenticated: false, user: null };
      }

      AuthManager._saveSession(data.session, data.session.user);
      return { authenticated: true, user: AuthManager.getUser() };
    } catch (error) {
      console.warn('Session check warning:', error);
      const cachedUser = AuthManager.getUser();
      if (cachedUser && AuthManager.getToken()) {
        return { authenticated: true, user: cachedUser, offline: true };
      }
      return { authenticated: false, user: null, error: error.message };
    }
  },

  // Log in with email and password using Supabase Auth
  async login(email, password) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      return { success: false, message: 'Please enter both your email address and password.' };
    }

    try {
      const client = await AuthManager._getClient();

      // Primary path: Supabase Auth
      if (client && client.auth) {
        const { data, error } = await client.auth.signInWithPassword({
          email: cleanEmail,
          password: String(password),
        });

        if (error) {
          const msg = error.message || '';
          const isUnverified =
            msg.toLowerCase().includes('email not confirmed') ||
            msg.toLowerCase().includes('not verified');

          if (isUnverified) {
            return {
              success: false,
              unverified: true,
              email: cleanEmail,
              message: 'Your email address is not verified yet. Please check your inbox or resend the verification email.',
            };
          }

          return {
            success: false,
            message:
              msg === 'Invalid login credentials'
                ? 'Invalid email or password. Please check your credentials.'
                : msg,
          };
        }

        if (data && data.session && data.user) {
          AuthManager._saveSession(data.session, data.user);
          return {
            success: true,
            user: AuthManager.getUser(),
            token: data.session.access_token,
            message: 'Signed in successfully.',
          };
        }

        return { success: false, message: 'Could not create an active session. Please try again.' };
      }

      // Secondary path: Backend auth endpoint
      const endpoint = (typeof window.getStudyFlowApiUrl === 'function')
        ? window.getStudyFlowApiUrl('/api/auth/login')
        : '/api/auth/login';
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password: String(password) }),
      });
      const rawText = await resp.text().catch(() => '');
      let json = {};
      try {
        json = JSON.parse(rawText);
      } catch (_) {
        json = { success: false, message: 'Invalid response from authentication server.' };
      }
      if (json.success && json.token && json.user) {
        AuthManager.setToken(json.token);
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(json.user));
      }
      return json;
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        message: 'Could not connect to authentication service. Please check your internet connection.',
      };
    }
  },

  // Sign up for a new account using Supabase Auth
  async signup(name, email, password, confirmPassword) {
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanName || cleanName.length < 2) {
      return { success: false, message: 'Please enter a valid full name (minimum 2 characters).' };
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return { success: false, message: 'Please provide a valid email address.' };
    }
    if (!password || password.length < 8) {
      return { success: false, message: 'Password must be at least 8 characters long.' };
    }
    if (password !== confirmPassword) {
      return { success: false, message: 'Passwords do not match. Please re-enter.' };
    }

    try {
      const client = await AuthManager._getClient();

      // Primary path: Supabase Auth
      if (client && client.auth) {
        const { data, error } = await client.auth.signUp({
          email: cleanEmail,
          password: String(password),
          options: {
            data: {
              name: cleanName,
              full_name: cleanName,
            },
          },
        });

        if (error) {
          return {
            success: false,
            message: error.message || 'Failed to create account.',
          };
        }

        const user = data && data.user;
        const session = data && data.session;
        const needsConfirmation = !session;

        if (session && user) {
          AuthManager._saveSession(session, user, cleanName);
          return {
            success: true,
            needsConfirmation: false,
            user: AuthManager.getUser(),
            token: session.access_token,
            message: 'Account created and signed in successfully! Redirecting...',
          };
        }

        return {
          success: true,
          needsConfirmation: true,
          email: cleanEmail,
          message: `Account created successfully! We sent a confirmation link to ${cleanEmail}. Please verify your email before logging in.`,
        };
      }

      // Secondary path: Backend auth endpoint
      const endpoint = (typeof window.getStudyFlowApiUrl === 'function')
        ? window.getStudyFlowApiUrl('/api/auth/signup')
        : '/api/auth/signup';
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          email: cleanEmail,
          password: String(password),
          confirmPassword: String(confirmPassword),
        }),
      });
      const rawText = await resp.text().catch(() => '');
      let json = {};
      try {
        json = JSON.parse(rawText);
      } catch (_) {
        json = { success: false, message: 'Invalid response from registration server.' };
      }
      return json;
    } catch (error) {
      console.error('Signup error:', error);
      return {
        success: false,
        message: error.message || 'Network error while registering. Please try again.',
      };
    }
  },

  // Resend verification email using Supabase Auth
  async resendVerification(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    try {
      const client = await AuthManager._getClient();
      if (client && client.auth) {
        const { error } = await client.auth.resend({
          type: 'signup',
          email: cleanEmail,
        });

        if (error) {
          return {
            success: false,
            message: error.message || 'Failed to resend confirmation email.',
          };
        }

        return {
          success: true,
          message: `Verification link resent to ${cleanEmail}. Please check your inbox and spam folder.`,
        };
      }

      // Backend fallback
      const endpoint = (typeof window.getStudyFlowApiUrl === 'function')
        ? window.getStudyFlowApiUrl('/api/auth/resend-verification')
        : '/api/auth/resend-verification';
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const rawText = await resp.text().catch(() => '');
      let json = {};
      try {
        json = JSON.parse(rawText);
      } catch (_) {
        json = { success: false, message: 'Invalid response from email service.' };
      }
      return json;
    } catch (error) {
      return {
        success: false,
        message: 'Network error while resending verification email.',
      };
    }
  },

  // Log out using Supabase Auth and invalidate local session
  async logout() {
    try {
      const client = await AuthManager._getClient();
      if (client && client.auth) {
        await client.auth.signOut();
      }
    } catch (e) {
      console.warn('Supabase logout notice:', e);
    } finally {
      AuthManager._clearSession();
      window.location.href = 'index.html?auth=logged_out';
    }
  },

  // Protect private pages (e.g. dashboard.html)
  async requireAuth() {
    const session = await AuthManager.checkSession();
    if (!session || !session.authenticated) {
      window.location.href = 'index.html?auth=login';
      return false;
    }
    return session.user;
  },

  // Safe JSON response parser
  async _safeJson(response) {
    if (!response) return null;
    try {
      const text = await response.text();
      if (!text || !text.trim()) return null;
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  },

  // Sync user study data to/from server with Supabase Bearer token
  async syncUserData(studyData) {
    try {
      const response = await AuthManager.fetchWithAuth('/api/user/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(studyData),
      });
      return await AuthManager._safeJson(response);
    } catch (e) {
      console.warn('Background study data sync note:', e.message);
      return null;
    }
  },

  // Fetch user study data from server with Supabase Bearer token
  async fetchUserData() {
    try {
      const response = await AuthManager.fetchWithAuth('/api/user/data', {
        method: 'GET',
      });
      const data = await AuthManager._safeJson(response);
      if (response && response.ok && data && data.success) {
        return data.data;
      }
      return null;
    } catch (e) {
      console.warn('Fetch study data note:', e.message);
      return null;
    }
  },

  // ─── SUPABASE SUBJECTS API METHODS ──────────────────────────
  // GET /api/subjects
  async getSupabaseSubjects() {
    try {
      const response = await AuthManager.fetchWithAuth('/api/subjects', {
        method: 'GET',
      });
      const data = await AuthManager._safeJson(response);
      if (response && response.ok && data && data.success && Array.isArray(data.data)) {
        return data.data;
      }
      return null;
    } catch (e) {
      console.warn('[Supabase] getSupabaseSubjects error:', e.message);
      return null;
    }
  },

  // POST /api/subjects
  async createSupabaseSubject(subjectPayload) {
    try {
      const response = await AuthManager.fetchWithAuth('/api/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subjectPayload),
      });
      const data = await AuthManager._safeJson(response);
      return { ok: response.ok, status: response.status, data };
    } catch (e) {
      console.warn('[Supabase] createSupabaseSubject error:', e.message);
      return { ok: false, error: e.message };
    }
  },

  // PATCH /api/subjects/:id
  async updateSupabaseSubject(id, updatePayload) {
    try {
      if (!id || String(id).startsWith('sub_')) return { ok: false, message: 'Invalid ID' };
      const response = await AuthManager.fetchWithAuth(`/api/subjects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });
      const data = await AuthManager._safeJson(response);
      return { ok: response.ok, status: response.status, data };
    } catch (e) {
      console.warn('[Supabase] updateSupabaseSubject error:', e.message);
      return { ok: false, error: e.message };
    }
  },

  // DELETE /api/subjects/:id
  async deleteSupabaseSubject(id) {
    try {
      if (!id || String(id).startsWith('sub_')) return { ok: false, message: 'Invalid ID' };
      const response = await AuthManager.fetchWithAuth(`/api/subjects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await AuthManager._safeJson(response);
      return { ok: response.ok, status: response.status, data };
    } catch (e) {
      console.warn('[Supabase] deleteSupabaseSubject error:', e.message);
      return { ok: false, error: e.message };
    }
  },
};

// Global helper functions for legacy & inline compatibility
window.AuthManager = AuthManager;
window.isLoggedIn = () => !!AuthManager.getUser();
window.logout = () => AuthManager.logout();
window.requireAuth = () => AuthManager.requireAuth();
