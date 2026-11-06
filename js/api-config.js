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
      host === '[::1]' ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
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

    // Check backend health
    checkBackendHealth: async function () {
      try {
        const url = config.getApiUrl('/api/health');
        const res = await fetch(url, { method: 'GET' });
        if (res.ok) {
          const ct = (res.headers && res.headers.get('content-type')) || '';
          if (ct.includes('application/json')) {
            const data = await res.json().catch(() => null);
            return { online: true, url, data };
          }
        }
        return { online: false, url, status: res.status };
      } catch (err) {
        return { online: false, url: config.getApiUrl('/api/health'), error: err.message };
      }
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

  // Eager background check in local environment to guide the developer
  if (typeof window !== 'undefined' && isLocalEnvironment() && window.location.port !== '5000') {
    setTimeout(async () => {
      const health = await config.checkBackendHealth();
      if (!health.online) {
        console.info(
          '%c[StudyFlow Info]%c Backend server not detected on http://localhost:5000.\n' +
          '• If using AI Syllabus Analysis or PYQ features, please start your backend in terminal:\n' +
          '  npm start\n' +
          '• Or open http://localhost:5000/dashboard.html directly in your browser.',
          'color:#6366f1;font-weight:bold;',
          'color:inherit;'
        );
      }
    }, 1500);
  }

  global.STUDYFLOW_CONFIG = Object.assign(global.STUDYFLOW_CONFIG || {}, config);
  global.getStudyFlowApiUrl = config.getApiUrl;
})(typeof window !== 'undefined' ? window : this);

