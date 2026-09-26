#!/usr/bin/env bash
# One-click production installer for OpenCode Manager (VPS + Caddy + automatic TLS).
#
#   ./install.sh --domain opencode.example.com --email you@example.com
#
# Re-running is safe: an existing .env is reused and secrets are never rotated.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="$dir/docker-compose.prod.yml"
template="$dir/.env.production.example"
env_file="$dir/.env"
compose=(docker compose -f "$compose_file")
# shellcheck source=lib.sh
source "$dir/lib.sh"

domain=""
acme_email=""
admin_email=""
admin_password=""
workspace=""
puid=""
pgid=""
assume_yes=0
force=0
skip_build=0
no_start=0
dry_run=0

usage() {
  cat <<'EOF'
One-click production installer for OpenCode Manager.

Usage: ./install.sh [options]

Options:
  --domain <host>          Public domain (required, e.g. opencode.example.com)
  --email <address>        ACME account email (Let's Encrypt notices)
  --admin-email <address>  First administrator email (default: admin@<domain>)
  --admin-password <pw>    First administrator password (default: generated)
  --workspace <path>       Host workspace directory (default: ~/opencode/workspace)
  --puid <uid>             Container workspace owner uid (default: current uid)
  --pgid <gid>             Container workspace owner gid (default: current gid)
  --force                  Recreate .env even if it exists (rotates secrets!)
  --skip-build             Do not rebuild the image
  --no-start               Prepare configuration only
  --dry-run                Print actions without changing anything
  -y, --yes                Non-interactive (requires --domain)
  -h, --help               Show this help

After install:
  ./smoke-test.sh          Verify TLS, auth, headers and port exposure
  ./backup.sh              Back up the database volume and workspace
EOF
}

log()  { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) domain="${2:-}"; shift 2 ;;
    --email) acme_email="${2:-}"; shift 2 ;;
    --admin-email) admin_email="${2:-}"; shift 2 ;;
    --admin-password) admin_password="${2:-}"; shift 2 ;;
    --workspace) workspace="${2:-}"; shift 2 ;;
    --puid) puid="${2:-}"; shift 2 ;;
    --pgid) pgid="${2:-}"; shift 2 ;;
    --force) force=1; shift ;;
    --skip-build) skip_build=1; shift ;;
    --no-start) no_start=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    -y|--yes) assume_yes=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1 (see --help)" ;;
  esac
done

[[ -f "$template" ]] || die "Missing $template"
[[ -f "$compose_file" ]] || die "Missing $compose_file"

# ---- prerequisites ---------------------------------------------------------
if [[ "$dry_run" != "1" ]]; then
  command -v docker >/dev/null 2>&1 || die "docker is required"
  docker compose version >/dev/null 2>&1 || die "docker compose v2 is required"
  command -v openssl >/dev/null 2>&1 || die "openssl is required"
fi

# ---- inputs ----------------------------------------------------------------
if [[ -z "$domain" ]]; then
  if [[ "$assume_yes" == "1" || "$dry_run" == "1" ]]; then
    die "--domain is required (see --help)"
  fi
  read -r -p "Public domain (e.g. opencode.example.com): " domain
fi
[[ "$domain" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || die "Invalid domain: $domain"
[[ "$domain" != *".."* ]] || die "Invalid domain: $domain"

[[ -n "$acme_email" ]] || acme_email="admin@${domain}"
[[ -n "$admin_email" ]] || admin_email="admin@${domain}"
[[ -n "$puid" ]] || puid="$(id -u)"
[[ -n "$pgid" ]] || pgid="$(id -g)"
[[ -n "$workspace" ]] || workspace="${HOME:-/root}/opencode/workspace"

replace_env() {
  local key="$1" value="$2" escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\\&|]/\\&/g')"
  if grep -qE "^${key}=" "$env_file"; then
    sed -i "s|^${key}=.*$|${key}=${escaped}|" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

# ---- generate configuration ------------------------------------------------
if [[ "$dry_run" == "1" ]]; then
  log "DRY RUN: no files will be created or containers started"
  echo "  domain         : $domain"
  echo "  acme email     : $acme_email"
  echo "  admin email    : $admin_email"
  echo "  workspace      : $workspace"
  echo "  puid:pgid      : $puid:$pgid"
  echo "  env file       : ${env_file} $([[ -f $env_file ]] && echo '(exists, will be reused)')"
  echo "  steps          : create workspace -> build -> docker compose up -d -> health check"
  exit 0
fi

if [[ ! -f "$env_file" || "$force" == "1" ]]; then
  log "Generating $env_file"
  cp "$template" "$env_file"
  generated_password="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  [[ -n "$admin_password" ]] || admin_password="$generated_password"
  replace_env AUTH_SECRET "$(openssl rand -base64 32)"
  replace_env OCM_DOMAIN "$domain"
  replace_env OCM_ACME_EMAIL "$acme_email"
  replace_env ADMIN_EMAIL "$admin_email"
  replace_env ADMIN_PASSWORD "$admin_password"
  replace_env AUTH_TRUSTED_ORIGINS "https://${domain}"
  replace_env PASSKEY_RP_ID "$domain"
  replace_env PASSKEY_ORIGIN "https://${domain}"
  replace_env OCM_WORKSPACE_HOST_PATH "$workspace"
  replace_env PUID "$puid"
  replace_env PGID "$pgid"
  chmod 600 "$env_file"
else
  log "Reusing existing $env_file (secrets are not rotated)"
  replace_env OCM_DOMAIN "$domain"
  replace_env AUTH_TRUSTED_ORIGINS "https://${domain}"
  replace_env PASSKEY_RP_ID "$domain"
  replace_env PASSKEY_ORIGIN "https://${domain}"
  replace_env OCM_WORKSPACE_HOST_PATH "$workspace"
fi

# Read back the effective admin credentials for the summary without sourcing
# the compose env file (values may contain spaces).
admin_email_effective="$(read_env_var "$env_file" ADMIN_EMAIL)"
admin_password="$(read_env_var "$env_file" ADMIN_PASSWORD)"
[[ -n "$admin_email_effective" ]] || admin_email_effective="$admin_email"

# ---- workspace -------------------------------------------------------------
log "Preparing workspace $workspace"
mkdir -p "$workspace"
chown -R "$puid:$pgid" "$workspace" 2>/dev/null || warn "Could not chown $workspace (continuing)"

# ---- DNS / port sanity -----------------------------------------------------
if getent hosts "$domain" >/dev/null 2>&1; then
  log "DNS: $domain -> $(getent hosts "$domain" | awk '{print $1}' | paste -sd' ' -)"
else
  warn "DNS for $domain did not resolve yet; Caddy cannot obtain a certificate until it does"
fi
for port in 80 443; do
  if command -v ss >/dev/null 2>&1 && ss -ltnH "sport = :$port" 2>/dev/null | grep -q .; then
    warn "Port $port is already in use; stop the other service or Caddy will fail to bind"
  fi
done

# ---- build & start ---------------------------------------------------------
if [[ "$skip_build" != "1" ]]; then
  log "Building images (this can take several minutes)"
  "${compose[@]}" build
fi

if [[ "$no_start" == "1" ]]; then
  log "Configuration ready; start later with: docker compose -f $compose_file up -d"
  exit 0
fi

log "Preparing volumes"
project="${COMPOSE_PROJECT_NAME:-$(basename "$dir" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')}"
docker volume create "${project}_opencode-data" >/dev/null
docker volume create "${project}_caddy-data" >/dev/null
docker volume create "${project}_caddy-config" >/dev/null
docker run --rm \
  -v "${project}_opencode-data:/app/data" \
  -v "${project}_caddy-data:/data" \
  -v "${project}_caddy-config:/config" \
  alpine:3 sh -c "chown -R ${puid}:${pgid} /app/data && chown -R 1000:1000 /data /config"

log "Starting containers"
"${compose[@]}" up -d

log "Waiting for the app health check"
healthy=0
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' opencode-manager 2>/dev/null || echo missing)"
  if [[ "$status" == "healthy" ]]; then healthy=1; break; fi
  sleep 5
done

if [[ "$healthy" != "1" ]]; then
  warn "App did not report healthy in time. Inspect logs: docker compose -f $compose_file logs app"
else
  log "App is healthy"
fi

cat <<EOF

============================================================
OpenCode Manager is deployed
============================================================
URL          : https://${domain}
Admin email  : ${admin_email_effective}
Admin pass   : ${admin_password}

Change the password after first login, then remove ADMIN_PASSWORD
from deploy/.env (or keep it for disaster recovery).

Next steps:
  1. Open https://${domain} and sign in
  2. Create user accounts in Settings -> Users
  3. Verify with:  ./smoke-test.sh
  4. Schedule backups:  ./install-backup-timer.sh
EOF
