/**
 * auth.js
 * Comprehensive client-side authentication manager for StudyFlow
 * Ensures permanent login persistence across browser reloads, server restarts, and tab closures
 * until the user explicitly logs out.
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

  // Authenticated fetch wrapper that attaches token headers and credentials
  async fetchWithAuth(url, options = {}) {
    const token = AuthManager.getToken();
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

    return fetch(url, fetchConfig);
  },

  // Check active session / token authentication status
  async checkSession() {
    try {
      const response = await AuthManager.fetchWithAuth('/api/auth/me', {
        method: 'GET',
      });
      const data = await response.json();

      if (response.ok && data.authenticated && data.user) {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data.user));
        if (data.token) {
          AuthManager.setToken(data.token);
        }
        return { authenticated: true, user: data.user };
      } else {
        // If server explicitly confirmed user is logged out / token invalid
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(AUTH_TOKEN_KEY);
        return { authenticated: false, user: null };
      }
    } catch (error) {
      console.warn('Session check network warning:', error);
      // If offline / network glitch, fallback to locally cached user if available
      const cachedUser = AuthManager.getUser();
      if (cachedUser && AuthManager.getToken()) {
        return { authenticated: true, user: cachedUser, offline: true };
      }
      return { authenticated: false, user: null, error: error.message };
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

  // Log in with email and password
  async login(email, password) {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();

      if (response.ok && data.success) {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data.user));
        if (data.token) {
          AuthManager.setToken(data.token);
        }
        return { success: true, user: data.user, token: data.token, message: data.message };
      } else {
        return {
          success: false,
          unverified: data.unverified || false,
          email: data.email || null,
          message: data.message || 'Invalid email or password.',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: 'Could not connect to authentication server. Please try again.',
      };
    }
  },

  // Sign up for a new account
  async signup(name, email, password, confirmPassword) {
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, email, password, confirmPassword }),
      });
      const data = await response.json();

      if (response.ok && data.success) {
        return {
          success: true,
          message: data.message,
          email: data.email,
          devLink: data.devLink,
        };
      } else {
        return {
          success: false,
          message: data.message || 'Failed to create account.',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: 'Network error while registering. Please try again.',
      };
    }
  },

  // Resend verification email
  async resendVerification(email) {
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      return {
        success: response.ok && data.success,
        message: data.message || 'Verification email request completed.',
        devLink: data.devLink,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Network error while resending verification email.',
      };
    }
  },

  // Log out and invalidate session + clear local credentials
  async logout() {
    try {
      await AuthManager.fetchWithAuth('/api/auth/logout', {
        method: 'POST',
      });
    } catch (e) {
      console.warn('Logout request warning:', e);
    } finally {
      const user = AuthManager.getUser();
      if (user) {
        const uid = user._id || user.id || user.email;
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
      window.location.href = 'index.html?auth=logged_out';
    }
  },

  // Protect private pages (e.g. dashboard.html)
  async requireAuth() {
    const session = await AuthManager.checkSession();
    if (!session.authenticated) {
      window.location.href = 'index.html?auth=login';
      return false;
    }
    return session.user;
  },

  // Sync user data to/from server
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

  // Fetch user data from server
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
};

// Global helper functions for legacy & inline compatibility
window.AuthManager = AuthManager;
window.isLoggedIn = () => !!AuthManager.getUser();
window.logout = () => AuthManager.logout();
window.requireAuth = () => AuthManager.requireAuth();
