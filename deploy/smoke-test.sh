#!/usr/bin/env bash
# Post-deploy smoke test: TLS, security headers, auth gating and port exposure.
#
#   ./smoke-test.sh [--domain host] [--skip-login]
set -uo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="$dir/.env"
domain=""
skip_login=0
# shellcheck source=lib.sh
source "$dir/lib.sh"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) domain="${2:-}"; shift 2 ;;
    --skip-login) skip_login=1; shift ;;
    -h|--help) echo "Usage: ./smoke-test.sh [--domain host] [--skip-login]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -f "$env_file" && -z "$domain" ]]; then
  domain="$(read_env_var "$env_file" OCM_DOMAIN)"
fi
[[ -n "$domain" ]] || { echo "Provide --domain or set OCM_DOMAIN in deploy/.env" >&2; exit 1; }

admin_email="$(read_env_var "$env_file" ADMIN_EMAIL)"
admin_password="$(read_env_var "$env_file" ADMIN_PASSWORD)"

base="https://${domain}"
jar="$(mktemp)"
trap 'rm -f "$jar"' EXIT
pass=0
fail=0

ok()   { printf '  \033[1;32mPASS\033[0m %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf '  \033[1;31mFAIL\033[0m %s\n' "$1"; fail=$((fail + 1)); }
skip() { printf '  \033[1;33mSKIP\033[0m %s\n' "$1"; }

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }
header_value() { curl -s -D - -o /dev/null --max-time 15 "$1" | tr -d '\r' | awk -F': ' -v h="$2" 'tolower($1)==h {print $2; exit}'; }

echo "Smoke test for ${base}"

# 1. HTTP -> HTTPS redirect
redirect="$(http_code "http://${domain}/")"
if [[ "$redirect" =~ ^30[178]$ ]]; then ok "HTTP redirects to HTTPS ($redirect)"; else bad "HTTP redirect expected 301/307/308, got $redirect"; fi

# 2. Health endpoint
health="$(http_code "${base}/api/health")"
if [[ "$health" == "200" ]]; then ok "GET /api/health -> 200"; else bad "GET /api/health -> $health"; fi

# 3. Security headers
hsts="$(header_value "${base}/" "strict-transport-security")"
csp="$(header_value "${base}/" "content-security-policy")"
[[ -n "$hsts" ]] && ok "HSTS present" || bad "HSTS header missing"
[[ -n "$csp" ]] && ok "CSP present" || bad "CSP header missing"

# 4. Unauthenticated API is gated
unauth="$(http_code "${base}/api/terminal/config")"
if [[ "$unauth" == "401" || "$unauth" == "403" ]]; then ok "Unauthenticated /api/terminal/config -> $unauth"; else bad "Expected 401/403, got $unauth"; fi

# 5. Self-registration is blocked
signup="$(http_code -X POST "${base}/api/auth/sign-up/email" -H 'Content-Type: application/json' \
  -d '{"email":"smoke-test@example.com","password":"password123","name":"Smoke"}')"
if [[ "$signup" == "403" ]]; then ok "Self-signup blocked -> 403"; else bad "Self-signup was not blocked (got $signup)"; fi

# 6/7. Admin login and privileged access
if [[ "$skip_login" == "1" || -z "$admin_email" || -z "$admin_password" ]]; then
  skip "Admin login checks (no ADMIN_EMAIL/ADMIN_PASSWORD in .env, or --skip-login)"
else
  login="$(http_code -c "$jar" -X POST "${base}/api/auth/sign-in/email" -H 'Content-Type: application/json' \
    -d "{\"email\":\"${admin_email}\",\"password\":\"${admin_password}\"}")"
  if [[ "$login" == "200" ]]; then ok "Admin login -> 200"; else bad "Admin login -> $login"; fi

  users="$(http_code -b "$jar" "${base}/api/admin/users")"
  if [[ "$users" == "200" ]]; then ok "GET /api/admin/users (authenticated) -> 200"; else bad "GET /api/admin/users -> $users"; fi

  term="$(http_code -b "$jar" "${base}/api/terminal/config")"
  if [[ "$term" == "200" ]]; then ok "GET /api/terminal/config (admin) -> 200"; else bad "GET /api/terminal/config (admin) -> $term"; fi
fi

# 8. Internal ports must not be reachable from the internet
if command -v nmap >/dev/null 2>&1; then
  open_ports="$(nmap -Pn -p 5003,5551,5100-5103 "$domain" 2>/dev/null | awk '/^[0-9]+\// {split($1,a,"/"); if ($2=="open") print a[1]}' | paste -sd, -)"
  if [[ -z "$open_ports" ]]; then ok "Internal ports 5003/5551/5100-5103 are closed"; else bad "Internal ports are reachable: $open_ports"; fi
else
  skip "Port exposure check (nmap not installed)"
fi

echo
echo "Result: ${pass} passed, ${fail} failed"
[[ "$fail" == "0" ]]
