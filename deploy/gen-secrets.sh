#!/usr/bin/env bash
# Generate a production .env for deploy/docker-compose.prod.yml.
# Usage: ./gen-secrets.sh [domain] [admin-email]
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
example="$dir/.env.production.example"
target="$dir/.env"

if [[ -f "$target" ]]; then
  echo "Refusing to overwrite existing $target" >&2
  exit 1
fi

domain="${1:-opencode.example.com}"
admin_email="${2:-you@example.com}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate secrets" >&2
  exit 1
fi

auth_secret="$(openssl rand -base64 32)"
admin_password="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"

cp "$example" "$target"

replace() {
  local key="$1" value="$2"
  # Use a literal, delimiter-safe substitution (value has no '|').
  sed -i "s|^${key}=.*|${key}=${value}|" "$target"
}

replace OCM_DOMAIN "$domain"
replace OCM_ACME_EMAIL "$admin_email"
replace AUTH_SECRET "$auth_secret"
replace ADMIN_EMAIL "$admin_email"
replace ADMIN_PASSWORD "$admin_password"
replace AUTH_TRUSTED_ORIGINS "https://${domain}"
replace PASSKEY_RP_ID "$domain"
replace PASSKEY_ORIGIN "https://${domain}"

chmod 600 "$target"

cat <<EOF
Wrote $target (mode 600)

Public URL : https://${domain}
Admin email: ${admin_email}
Admin pass : ${admin_password}

Next steps:
  1. Point ${domain} at this host.
  2. Edit ${target} and set OCM_WORKSPACE_HOST_PATH to a dedicated directory.
  3. docker compose -f docker-compose.prod.yml up -d --build
EOF
