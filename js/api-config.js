/**
 * StudyFlow247 - Centralized API & Environment Configuration
 * 
 * Supports:
 * - Localhost / 127.0.0.1 / file:// (development)
 * - Netlify static hosting (https://studyflow247.netlify.app)
 * - Cloud backend deployment (Render, Railway, etc.)
 * - Runtime override via localStorage or window.STUDYFLOW_API_URL
 */
(function (global) {
  'use strict';

  // ── 1. PRODUCTION DEPLOYED BACKEND URL ──────────────────────────────────────
  // When your Express backend is deployed on Render (e.g. 'https://studyflow247-backend.onrender.com'),
  // you can specify it here.
  // If left as '' (empty string), frontend requests use relative paths ('/api/...'),
  // which are automatically forwarded to the backend via Netlify's _redirects file.
  const DEPLOYED_BACKEND_URL = '';

  // ── 2. LOCAL ENVIRONMENT DETECTION ──────────────────────────────────────────
  function isLocalEnvironment() {
    if (typeof window === 'undefined') return false;
    const host = window.location.hostname || '';
    const proto = window.location.protocol || '';
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      proto === 'file:'
    );
  }

  // ── 3. RESOLVE ACTIVE API BASE URL ──────────────────────────────────────────
  function resolveApiBaseUrl() {
    // Priority A: Runtime global override (window.STUDYFLOW_API_URL)
    if (typeof global.STUDYFLOW_API_URL === 'string' && global.STUDYFLOW_API_URL.trim()) {
      return global.STUDYFLOW_API_URL.trim().replace(/\/+$/, '');
    }

    // Priority B: Browser localStorage override (set via STUDYFLOW_CONFIG.setApiBaseUrl('...'))
    try {
      if (global.localStorage) {
        const stored = global.localStorage.getItem('studyflow_api_url');
        if (stored && stored.trim()) {
          return stored.trim().replace(/\/+$/, '');
        }
      }
    } catch (_) {}

    // Priority C: Localhost / Live Server / file://
    if (isLocalEnvironment()) {
      // If running directly on port 5000 (served by Node Express), use relative path
      if (typeof window !== 'undefined' && window.location.port === '5000') {
        return '';
      }
      return 'http://localhost:5000';
    }

    // Priority D: Production configured backend URL
    if (DEPLOYED_BACKEND_URL && DEPLOYED_BACKEND_URL.trim()) {
      return DEPLOYED_BACKEND_URL.trim().replace(/\/+$/, '');
    }

    // Priority E: Netlify proxy fallback (relative /api/* proxies via Netlify _redirects)
    return '';
  }

  // ── 4. CONFIGURATION OBJECT & HELPERS ───────────────────────────────────────
  const config = {
    isLocal: isLocalEnvironment(),

    // Get the base URL without trailing slash (e.g. "http://localhost:5000" or "")
    getApiBaseUrl: resolveApiBaseUrl,

    // Resolve an endpoint path to a complete URL
    getApiUrl: function (endpoint) {
      const base = resolveApiBaseUrl();
      const path = String(endpoint || '');
      if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
      }
      const cleanPath = path.startsWith('/') ? path : '/' + path;
      return base ? `${base}${cleanPath}` : cleanPath;
    },

    // Set or clear custom backend URL at runtime (persisted in localStorage)
    setApiBaseUrl: function (url) {
      try {
        if (url && typeof url === 'string') {
          global.localStorage.setItem('studyflow_api_url', url.trim());
          console.log('[StudyFlow Config] API base URL set to:', url.trim());
        } else if (global.localStorage) {
          global.localStorage.removeItem('studyflow_api_url');
          console.log('[StudyFlow Config] API base URL reset to default.');
        }
      } catch (_) {}
    },
  };

  global.STUDYFLOW_CONFIG = Object.assign(global.STUDYFLOW_CONFIG || {}, config);
  global.getStudyFlowApiUrl = config.getApiUrl;
})(typeof window !== 'undefined' ? window : this);

