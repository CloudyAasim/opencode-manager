# Dokku deployment runbook

This fork is deployed to a Dokku host by GitHub Actions. No manual steps are
required for a normal release: pushing to `main` builds the image, configures the
app, deploys it, and runs a health + authentication smoke test.

## Live app

| Item | Value |
| --- | --- |
| Host | `SERVER_HOST` (Dokku 0.38.30) |
| App | `opencode-manager` |
| Public URL | `http://SERVER_HOST:8080` |
| Dokku vhost | `APP_VHOST` |
| Admin account | created from `OCM_ADMIN_EMAIL` / `OCM_ADMIN_PASSWORD` GitHub secrets |

## Why port 8080

The provider blocks inbound TCP 80/443 at the network edge: connections are
accepted and then closed with no response, from any client region. The Dokku
nginx therefore listens on host `8080` (and keeps `80` configured for
environments where it is reachable). TLS termination is not possible on 443
until the provider allows it; front the app with Cloudflare (origin
`http://SERVER_HOST:8080`) or another proxy when a public HTTPS URL is
required.

## Why zero-downtime checks are disabled

The host's `docker-container-healthchecker` binary is built against a newer glibc
(`GLIBC_2.32`/`GLIBC_2.34` not found) than the host provides. The Dokku
`check-deploy` hook runs under `set -e`, so pre-flight checks abort for every app
regardless of app health. `dokku checks:disable opencode-manager` is applied by
the deploy workflow.

## Persistent storage

| Host path | Container path |
| --- | --- |
| `/var/lib/dokku/data/storage/ocm-data` | `/app/data` (SQLite database) |
| `/var/lib/dokku/data/storage/ocm-workspace` | `/workspace` (user workspaces) |

Both are created with `storage:ensure-directory --chown 1000` and mounted by the
deploy workflow, so data survives container recreation.

## Operating

```shell
# Redeploy current main
gh workflow run deploy.yml

# Collect logs, ports, storage, nginx config and probes
gh workflow run dokku-diagnostics.yml

# Follow deployment
gh run watch $(gh run list --workflow=deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

## Known behaviour

- OpenCode cold start takes roughly two minutes on a fresh workspace. The
  supervisor's 30s health probe reports a transient failure and then recovers;
  `/api/health` settles on `opencode: healthy`.
- `opencodeVersion` is reported as `null` because the version probe cannot read
  the bundled binary; this is display-only and does not gate features.
