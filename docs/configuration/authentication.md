# Authentication

OpenCode Manager uses single-user authentication designed for personal deployments.

## Overview

The authentication system supports:

- Email/password login
- Passkey/WebAuthn authentication
- OAuth social login (optional)
- Session-based auth with secure cookies

## Account Management

OpenCode Manager defaults to **no self-registration**. Accounts can only be created by:

1. Setting `ADMIN_EMAIL` + `ADMIN_PASSWORD` (bootstrap administrator on first startup).
2. An administrator creating users in **Settings → Users** (create, change role, reset
   password, delete).

`AUTH_ALLOW_SIGNUP=false` (the default) blocks the email sign-up endpoint *and* blocks
new identities created through an OAuth provider. Set it to `true` only on a trusted
network. `AUTH_ALLOWED_EMAILS` / `AUTH_ALLOWED_EMAIL_DOMAINS` allow specific sign-ups
without opening registration.

Roles are `admin` and `user`. Administrators can manage accounts; the last remaining
administrator cannot be deleted or demoted, and you cannot delete your own account.

## Rate Limiting

The authentication API is rate limited per client IP out of the box:

| Endpoint | Limit |
|----------|-------|
| `/sign-in/email` | 5 / minute |
| `/sign-up/email` | 3 / minute |
| `/sign-in/passkey` | 10 / minute |
| `/forget-password` | 3 / minute |

Set `AUTH_TRUST_PROXY=true` when running behind a reverse proxy (Caddy, Nginx,
Cloudflare) so the real client IP is used. Leave it `false` when the application port is
exposed directly, otherwise clients can spoof the header and bypass the limits.

## First-Run Setup

Self-registration is disabled, so the first administrator is created from the
environment. Set:

```bash
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password
```

On startup the account is created (or promoted to `admin` if it already exists) and you
sign in with those credentials. If no account exists and `ADMIN_*` is not configured, the
app shows a notice and logs a warning — it cannot be used until an administrator exists.

## Pre-Configured Admin

Skip interactive setup for automated deployments:

```bash
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password
```

When set:

- Admin user is created automatically
- Setup wizard is skipped
- Registration is disabled

## Password Reset

If you forget your password:

1. Set environment variables:

```bash
ADMIN_EMAIL=your@email.com
ADMIN_PASSWORD=new-password
ADMIN_PASSWORD_RESET=true
```

2. Restart the application:

```bash
docker-compose restart
```

3. Log in with new password

4. Remove `ADMIN_PASSWORD_RESET=true` from environment

!!! warning
    Remove the reset flag after successful reset to prevent accidental password changes.

## Session Security

### AUTH_SECRET

Required for production. Encrypts session data.

Generate:
```bash
openssl rand -base64 32
```

Configure:
```bash
AUTH_SECRET=your-generated-secret
```

### Session Duration

Sessions expire after 7 days. A new session is created on each login.

### Secure Cookies

By default, cookies require HTTPS in production:

```bash
# For HTTP on trusted networks only
AUTH_SECURE_COOKIES=false
```

## Remote Access

### Local Network (HTTP)

For accessing via IP on a local network:

```bash
# Include all access URLs (both frontend and backend)
AUTH_TRUSTED_ORIGINS=http://localhost:5173,http://localhost:5003,http://192.168.1.244:5003

# Disable secure cookies for HTTP
AUTH_SECURE_COOKIES=false
```

### Production (HTTPS)

For production with HTTPS:

```bash
AUTH_TRUSTED_ORIGINS=https://yourdomain.com
# AUTH_SECURE_COOKIES defaults to true
```

## Passkeys

Passwordless authentication using WebAuthn.

### Setup

Configure your domain:

```bash
# Local development (use backend port)
PASSKEY_RP_ID=localhost
PASSKEY_RP_NAME=OpenCode Manager
PASSKEY_ORIGIN=http://localhost:5003

# Production
PASSKEY_RP_ID=yourdomain.com
PASSKEY_RP_NAME=OpenCode Manager
PASSKEY_ORIGIN=https://yourdomain.com

# Local network access
PASSKEY_RP_ID=localhost
PASSKEY_RP_NAME=OpenCode Manager
PASSKEY_ORIGIN=http://192.168.1.244:5003
```

!!! note "Port Selection"
    - Use the **backend** port (5003) for PASSKEY_ORIGIN
    - Not the frontend port (5173)
    - The origin must match where the auth API is served

### Adding a Passkey

1. Log in with password
2. Go to **Settings > Account**
3. Click **Add Passkey**
4. Follow browser/device prompts
5. Name your passkey

### Supported Authenticators

- Touch ID / Face ID (macOS, iOS)
- Windows Hello
- Hardware security keys (YubiKey, etc.)
- Android fingerprint/face

### Passkey Requirements

- RP ID must match the domain
- Origin must match exactly (including port)
- HTTPS recommended (required for some browsers)

## Troubleshooting

### Can't Log In

1. Clear browser cookies
2. Check credentials are correct
3. Verify AUTH_SECRET hasn't changed
4. Check AUTH_TRUSTED_ORIGINS includes your URL

### Session Keeps Expiring

1. Check AUTH_SECRET is persistent across restarts
2. Verify cookies aren't being blocked
3. Check AUTH_SECURE_COOKIES setting

### Passkey Not Working

1. Verify PASSKEY_RP_ID matches domain
2. Check PASSKEY_ORIGIN is exact
3. Try a different browser
4. Ensure WebAuthn is supported
