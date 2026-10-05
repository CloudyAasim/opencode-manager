# Environment Variables

Complete reference for all configuration options.

## Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_SECRET` | Session encryption secret (required for production) | Auto-generated in dev |
| `ADMIN_EMAIL` | Pre-configured admin email | - |
| `ADMIN_PASSWORD` | Pre-configured admin password | - |
| `ADMIN_PASSWORD_RESET` | Set to `true` to reset admin password | `false` |
| `AUTH_TRUSTED_ORIGINS` | Comma-separated list of trusted origins (frontend + backend) | `http://localhost:5173,http://localhost:5003` |
| `AUTH_SECURE_COOKIES` | Use secure cookies (HTTPS only) | `true` in prod, `false` in dev |
| `AUTH_ALLOW_SIGNUP` | Allow public self-registration / new OAuth users | `false` |
| `AUTH_ALLOWED_EMAILS` | Comma-separated emails allowed to sign up while registration is off | - |
| `AUTH_ALLOWED_EMAIL_DOMAINS` | Comma-separated email domains allowed to sign up while registration is off | - |
| `AUTH_SESSION_EXPIRES_IN_DAYS` | Session lifetime in days | `7` |
| `AUTH_RATE_LIMIT_ENABLED` | Enable built-in auth rate limiting | `true` |
| `AUTH_TRUST_PROXY` | Trust proxy client-IP headers for per-IP rate limiting. Prefers `x-real-ip` over `x-forwarded-for`; enable only behind a reverse proxy that overwrites them | `false` |

## OAuth Providers

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret |

## Passkeys (WebAuthn)

| Variable | Description | Default |
|----------|-------------|---------|
| `PASSKEY_RP_ID` | Relying party ID (your domain) | `localhost` |
| `PASSKEY_RP_NAME` | Display name for passkey prompts | `OpenCode Manager` |
| `PASSKEY_ORIGIN` | Origin URL for WebAuthn (backend port) | `http://localhost:5003` |


## Security Headers

| Variable | Description | Default |
|----------|-------------|---------|
| `SECURITY_HSTS` | Send `Strict-Transport-Security` | `true` in production |
| `SECURITY_CSP` | Override the default `Content-Security-Policy` (empty string disables it) | Built-in policy |

The built-in CSP allows the SPA to load its own assets and inline styles. If a feature
that needs `eval` or an external origin is added, set `SECURITY_CSP` explicitly.

## Push Notifications (VAPID)

| Variable | Description | Required |
|----------|-------------|----------|
| `VAPID_PUBLIC_KEY` | VAPID public key for push notifications | Yes |
| `VAPID_PRIVATE_KEY` | VAPID private key for push notifications | Yes |
| `VAPID_SUBJECT` | Contact email for VAPID (MUST use `mailto:` format) | Yes |

### Generating VAPID Keys

Generate VAPID public/private key pair:

```bash
pnpm dlx web-push generate-vapid-keys
```

Add to `.env`:

```bash
VAPID_PUBLIC_KEY=BMx-1234567890abcdefghijklmnopqrstuv...
VAPID_PRIVATE_KEY=abcd1234567890abcdef...
VAPID_SUBJECT=mailto:you@example.com
```

!!! warning "iOS/Safari Requirement"
    `VAPID_SUBJECT` **MUST** use `mailto:` format for iOS/Safari push notifications to work. Apple's push service rejects `https://` subjects.

    **Correct:** `VAPID_SUBJECT=mailto:you@yourdomain.com`
    **Incorrect:** `VAPID_SUBJECT=https://yourdomain.com`

When configured, users can enable push notifications in Settings → Notifications to receive background alerts for agent events.

## Server

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5003` |
| `HOST` | Server bind address | `0.0.0.0` |
| `NODE_ENV` | Environment (`development` or `production`) | `development` |
| `CORS_ORIGIN` | CORS origin for frontend | `http://localhost:5173` |
| `LOG_LEVEL` | Logging level | `info` |
| `DEBUG` | Enable debug logging | `false` |
| `OCM_ALLOW_SERVER_ENV_EDIT` | Allow non-admins to edit server environment variables (injected into the OpenCode process). Disabled in production by default | `false` in prod |

## Database

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_PATH` | Path to SQLite database file | `./data/opencode.db` |

## Workspace

| Variable | Description | Default |
|----------|-------------|---------|
| `WORKSPACE_PATH` | Path to workspace directory | `./workspace` (Docker: `/workspace`) |

## OpenCode Server

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENCODE_SERVER_PORT` | Port for the OpenCode CLI server | `5551` |
| `OPENCODE_HOST` | OpenCode server bind address | `127.0.0.1` |
| `OPENCODE_PUBLIC_URL` | Public URL passed to OpenCode for OAuth callbacks | - |
| `OPENCODE_HEALTH_WATCH_ENABLED` | Enable OpenCode health watcher and recovery | `true` (`false` in tests) |
| `OPENCODE_HEALTH_POLL_MS` | OpenCode health watcher poll interval | `30000` |
| `OPENCODE_HEALTH_FAILURE_THRESHOLD` | Failed health checks before recovery starts | `2` |
| `OPENCODE_SERVER_PASSWORD` | Basic Auth password required when binding OpenCode to a non-loopback host. Can also be set via UI (Settings → OpenCode → Server Auth). DB-stored passwords override this env var. | - |
| `OPENCODE_SERVER_USERNAME` | Basic Auth username | `opencode` |

## OpenCode Import

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENCODE_IMPORT_CONFIG_PATH` | Existing standalone OpenCode config file to import on first startup. When set to a single file, only that file is imported. When unset, the host's recognized config files (`config.json`, `opencode.json`, `opencode.jsonc`) are mirrored into the workspace and workspace copies absent on the host are removed | - |
| `OPENCODE_IMPORT_STATE_PATH` | Existing standalone OpenCode state directory to import on first startup | - |

## Web Terminal

The web terminal runs an interactive shell inside the container. Non-admin sessions are
sandboxed so they can only reach the user's own workspace; admin sessions run directly
in the container. Every session is recorded in the `terminal_audit` table (user, IP,
user agent, shell, cwd, start/end, exit code).

| Variable | Description | Default |
|----------|-------------|---------|
| `OCM_TERMINAL_ENABLED` | Enable the web terminal | `true` |
| `OCM_TERMINAL_ISOLATE` | Run non-admin sessions inside a per-user sandbox (`unshare` + `chroot`) | `true` |
| `OCM_TERMINAL_SHELL` | Shell to launch | `/bin/bash` |
| `OCM_TERMINAL_CWD` | Working directory (must be inside `WORKSPACE_PATH`, otherwise the workspace root is used) | workspace root |
| `OCM_TERMINAL_COLS` / `OCM_TERMINAL_ROWS` | Default dimensions | `120` / `30` |
| `OCM_TERMINAL_MAX_SESSIONS_PER_USER` | Concurrent sessions per user | `2` |
| `OCM_TERMINAL_MAX_SESSIONS_TOTAL` | Concurrent sessions overall | `4` |
| `OCM_TERMINAL_IDLE_TIMEOUT_MS` | Close a session after inactivity | `900000` |
| `OCM_TERMINAL_MAX_DURATION_MS` | Absolute session lifetime cap | `28800000` |
| `OCM_TERMINAL_ADMINS_ONLY` | Restrict the terminal to administrators | `false` — the terminal is open to everyone and the sandbox is what makes that safe. Set `true` to go back to admin-only. |
| `OCM_TERMINAL_PER_USER_HOME` | Give each user a private directory under the workspace | `true`. **Turning this off leaves non-admins with no terminal**: there is then no directory holding only their files, and the server refuses rather than binding the shared workspace, which holds every user's data. |
| `OCM_TERMINAL_USERS_DIR` | Subdirectory that holds per-user terminal homes | `users` |

!!! warning "Terminal equals shell access"
    A web terminal is equivalent to handing a shell to the signed-in user. Non-admin
    sessions are confined to the user's workspace; admin sessions are not. Use a
    dedicated container and workspace, keep it behind TLS, and leave
    `OCM_TERMINAL_ISOLATE=true`.

The PTY bridge requires `python3` (already present in the shipped image).

## Timeouts

| Variable | Description | Default |
|----------|-------------|---------|
| `PROCESS_START_WAIT_MS` | Wait time for OpenCode process to start | `2000` |
| `PROCESS_VERIFY_WAIT_MS` | Wait time for process health verification | `1000` |
| `HEALTH_CHECK_TIMEOUT_MS` | OpenCode liveness probe timeout | `30000` |

## File Limits

| Variable | Description | Default |
|----------|-------------|---------|
| `MAX_FILE_SIZE_MB` | Maximum file size for reading/preview | `50` |
| `MAX_UPLOAD_SIZE_MB` | Maximum upload file size | `50` |

## Frontend (Vite)

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL for frontend | `http://localhost:5003` |
| `VITE_SERVER_PORT` | Backend port hint for frontend | `5003` |
| `VITE_OPENCODE_PORT` | OpenCode server port hint | `5551` |
| `VITE_MAX_FILE_SIZE_MB` | File size limit for frontend | `50` |
| `VITE_MAX_UPLOAD_SIZE_MB` | Upload size limit for frontend | `50` |

## Example .env File

```bash
# Server
PORT=5003
HOST=0.0.0.0
NODE_ENV=development

# Required for production
AUTH_SECRET=generate-with-openssl-rand-base64-32

# Pre-configured admin (optional)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password

# Remote access (optional - include both frontend and backend ports)
AUTH_TRUSTED_ORIGINS=http://localhost:5173,http://localhost:5003,http://192.168.1.244:5003
AUTH_SECURE_COOKIES=false

# OAuth providers (optional)
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret

# Passkeys (optional - use BACKEND port)
PASSKEY_RP_ID=localhost
PASSKEY_RP_NAME=OpenCode Manager
PASSKEY_ORIGIN=http://localhost:5003

# Push notifications (optional)
VAPID_PUBLIC_KEY=BMx-1234567890abcdefghijklmnopqrstuv...
VAPID_PRIVATE_KEY=abcd1234567890abcdef...
VAPID_SUBJECT=mailto:you@example.com
```

## Generating Secrets

### AUTH_SECRET

Generate a secure random secret:

```bash
openssl rand -base64 32
```

Output example:
```
K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=
```


### VAPID Keys

Generate VAPID public/private key pair for push notifications:

```bash
pnpm dlx web-push generate-vapid-keys
```

Output example:
```
=======================================
Public Key:
BMx-1234567890abcdefghijklmnopqrstuv...

Private Key:
abcd1234567890abcdef...

Subject:
mailto:you@example.com
===========================================
```

!!! warning "iOS/Safari Requirement"
    `VAPID_SUBJECT` **MUST** use `mailto:` format for iOS/Safari push notifications to work.


## Environment Precedence

Local runtime loads `.env` from the project root with `dotenv` without overriding variables that are already present in the process environment. Docker Compose reads `.env` for interpolation, then passes the explicit `environment` entries from `docker-compose.yml` into the container.
