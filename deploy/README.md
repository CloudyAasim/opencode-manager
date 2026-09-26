# Production deployment (VPS + Caddy)

One-click install:

```bash
cd deploy
./install.sh --domain opencode.example.com --email you@example.com
./smoke-test.sh
```

`install.sh` generates `.env` with random secrets, prepares the workspace, builds the
image, starts the stack and waits for the health check. Re-running is safe (secrets are
reused).

## Scripts

| File | Purpose |
|------|---------|
| `install.sh` | one-click install (config + build + start + health) |
| `smoke-test.sh` | post-deploy verification (TLS, headers, auth, ports) |
| `backup.sh` | consistent backup of the database volume and workspace |
| `restore.sh` | restore the database volume and/or workspace |
| `install-backup-timer.sh` | daily backup via systemd timer or cron |
| `update.sh` | backup + rebuild + restart (`--pull` to git pull first) |
| `uninstall.sh` | stop containers (`--purge` deletes volumes) |
| `gen-secrets.sh` | only generate `.env` (manual setups) |
| `lib.sh` | shared env-reading helper (sourced, not run) |

## Configuration

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | app + Caddy; only 80/443 published |
| `Caddyfile` | TLS, security headers, overwrites forwarding headers |
| `.env.production.example` | production environment template |

The app is never published to the host; Caddy reaches it as `app:5003` over the internal
docker network. `5003`, `5551` and `5100-5103` stay private.

See `docs/cloud/one-click-deploy.md` for the full guide and go-live checklist.
