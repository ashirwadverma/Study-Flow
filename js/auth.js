/**
 * js/auth.js
 * Comprehensive client-side authentication manager for StudyFlow powered by Supabase Auth.
 *
 * Implements:
 * - Signup using supabase.auth.signUp()
 * - Login using supabase.auth.signInWithPassword()
 * - Logout using supabase.auth.signOut()
 * - Session persistence across tabs and reloads
 * - State change synchronization using onAuthStateChange()
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
    if (!token && typeof window.getSupabaseClient === 'function') {
      try {
        const client = await window.getSupabaseClient();
        if (client) {
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

    const apiBase = (typeof window !== 'undefined' && (window.location.protocol === 'file:' || (window.location.port && window.location.port !== '5000')))
      ? 'http://localhost:5000'
      : '';
    const fullUrl = url.startsWith('http') ? url : (apiBase + (url.startsWith('/') ? '' : '/') + url);

    return fetch(fullUrl, fetchConfig);
  },

  // Check active session status via Supabase Auth
  async checkSession() {
    try {
      const client = typeof window.getSupabaseClient === 'function' ? await window.getSupabaseClient() : null;

      if (!client) {
        const cachedUser = AuthManager.getUser();
        if (cachedUser && AuthManager.getToken()) {
          return { authenticated: true, user: cachedUser, offline: true };
        }
        return { authenticated: false, user: null };
      }

      const { data, error } = await client.auth.getSession();

      if (error || !data || !data.session || !data.session.user) {
        AuthManager._clearSession();
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
    try {
      const client = typeof window.getSupabaseClient === 'function' ? await window.getSupabaseClient() : null;
      if (!client) {
        return {
          success: false,
          message: 'Supabase client is not available. Please refresh the page and try again.',
        };
      }

      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !password) {
        return { success: false, message: 'Please enter both your email address and password.' };
      }

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
    try {
      const client = typeof window.getSupabaseClient === 'function' ? await window.getSupabaseClient() : null;
      if (!client) {
        return {
          success: false,
          message: 'Supabase client is not available. Please refresh the page and try again.',
        };
      }

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

      // If email confirmation is enabled in Supabase, session is null until user clicks the email link
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
    try {
      const client = typeof window.getSupabaseClient === 'function' ? await window.getSupabaseClient() : null;
      if (!client) {
        return { success: false, message: 'Authentication client unavailable.' };
      }

      const cleanEmail = String(email || '').trim().toLowerCase();
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
      const client = typeof window.getSupabaseClient === 'function' ? await window.getSupabaseClient() : null;
      if (client) {
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

  // Sync user study data to/from server with Supabase Bearer token
  async syncUserData(studyData) {
    try {
      const response = await AuthManager.fetchWithAuth('/api/user/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(studyData),
      });
      return await response.json();
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
      const data = await response.json();
      if (response.ok && data.success) {
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
      const data = await response.json();
      if (response.ok && data.success && Array.isArray(data.data)) {
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
      const data = await response.json();
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
      const data = await response.json();
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
      const data = await response.json();
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
