# Shared helpers for deploy scripts. Source this file, do not execute it.
#
# deploy/.env is a docker-compose env file, not a shell script (values may
# contain spaces, e.g. PASSKEY_RP_NAME=OpenCode Manager), so it must never be
# `source`d. Use read_env_var instead.

read_env_var() {
  local file="$1" key="$2" value=""
  if [[ -f "$file" ]]; then
    value="$(grep -E "^[[:space:]]*${key}=" "$file" 2>/dev/null | tail -n1 | sed -E "s/^[[:space:]]*${key}=//" || true)"
  fi
  printf '%s' "$value"
  return 0
}
