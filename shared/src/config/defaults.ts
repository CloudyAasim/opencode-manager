export const DEFAULTS = {
  SERVER: {
    PORT: 5003,
    HOST: '0.0.0.0',
    CORS_ORIGIN: 'http://localhost:5173',
  },

  FRONTEND: {
    PORT: 5173,
    HOST: '0.0.0.0',
  },

  OPENCODE: {
    PORT: 5551,
    HOST: '127.0.0.1',
    PUBLIC_URL: '', // Optional: public URL for OAuth callbacks (e.g., https://mydomain.com)
    HEALTH_WATCH_ENABLED: true,
    HEALTH_POLL_MS: 30000,
    HEALTH_FAILURE_THRESHOLD: 2,
  },

  DATABASE: {
    PATH: './data/opencode.db',
  },

  WORKSPACE: {
    BASE_PATH: './workspace',
    REPOS_DIR: 'repos',
    SCHEDULE_WORKTREES_DIR: 'schedule-worktrees',
    CONFIG_DIR: '.config/opencode',
    AUTH_FILE: '.opencode/state/opencode/auth.json',
  },

  TIMEOUTS: {
    PROCESS_START_WAIT_MS: 2000,
    PROCESS_VERIFY_WAIT_MS: 1000,
    HEALTH_CHECK_TIMEOUT_MS: 30000,
    HEALTH_CHECK_PROBE_TIMEOUT_MS: 2000,
    /** How long the browser waits on one API call. Routes that run something
     *  slow - a clone, an install - pass a larger budget of their own; see
     *  frontend/src/api/timeouts.ts, which derives those from the server's
     *  own budget rather than from taste. */
    HTTP_REQUEST_MS: 45000,
    /** Idempotent requests get one more attempt. A POST never does. */
    HTTP_GET_RETRIES: 1,
  },

  FILE_LIMITS: {
    MAX_SIZE_MB: 50,
    MAX_UPLOAD_SIZE_MB: 50,
  },

  LOGGING: {
    DEBUG: false,
    LOG_LEVEL: 'info',
  },

  LOGS: {
    BUFFER_CAPACITY: 2000,
    MAX_ENTRY_LENGTH: 4000,
    DEFAULT_PAGE_SIZE: 500,
    MAX_PAGE_SIZE: 1000,
    POLL_INTERVAL_MS: 8000,
  },

  SSE: {
    RECONNECT_DELAY_MS: 1000,
    MAX_RECONNECT_DELAY_MS: 30000,
    CONNECT_TIMEOUT_MS: 10000,
    IDLE_GRACE_PERIOD_MS: 5000,
    HEARTBEAT_INTERVAL_MS: 30000,
    STALL_THRESHOLD_MS: 90000,
    WATCHDOG_TICK_MS: 15000,
  },

  TERMINAL: {
    ENABLED: true,
    SHELL: '/bin/bash',
    COLS: 120,
    ROWS: 30,
    MAX_SESSIONS_PER_USER: 2,
    MAX_SESSIONS_TOTAL: 4,
    IDLE_TIMEOUT_MS: 15 * 60 * 1000,
    MAX_DURATION_MS: 8 * 60 * 60 * 1000,
    ADMINS_ONLY: true,
    PER_USER_HOME: true,
    USERS_DIR: 'users',
  },

  SECURITY: {
    HSTS_MAX_AGE: 'max-age=31536000; includeSubDomains',
    CONTENT_SECURITY_POLICY: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "media-src 'self' blob: data:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ].join('; '),
  },
} as const

export const ALLOWED_MIME_TYPES = [
  'text/plain',
  'text/html',
  'text/css',
  'text/javascript',
  'text/typescript',
  'application/json',
  'application/xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'application/zip',
  'text/markdown',
] as const

export const GIT_PROVIDERS = {
  GITHUB: 'github.com',
  GITLAB: 'gitlab.com',
  BITBUCKET: 'bitbucket.org',
} as const

export const OPENCODE_CONFIG_SOURCE_NAMES = ['config.json', 'opencode.json', 'opencode.jsonc'] as const
export type OpenCodeConfigSourceName = (typeof OPENCODE_CONFIG_SOURCE_NAMES)[number]

export type Config = typeof DEFAULTS
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]
export type GitProvider = (typeof GIT_PROVIDERS)[keyof typeof GIT_PROVIDERS]
