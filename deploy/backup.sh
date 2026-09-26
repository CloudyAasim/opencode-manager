#!/usr/bin/env bash
# Back up the OpenCode Manager database volume and workspace.
#
# Usage:
#   ./backup.sh                 # consistent backup (stops the app briefly)
#   BACKUP_ONLINE=1 ./backup.sh # hot backup without downtime (best effort)
#
# Environment (usually read from deploy/.env):
#   OCM_WORKSPACE_HOST_PATH  host workspace directory (if bind-mounted)
#   COMPOSE_PROJECT_NAME     compose project name (defaults to the dir name)
#   BACKUP_DIR               output directory (default: ./backups)
#   BACKUP_RETENTION         number of archives to keep per kind (default: 7)
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="$dir/docker-compose.prod.yml"
env_file="$dir/.env"
# shellcheck source=lib.sh
source "$dir/lib.sh"

[[ -f "$env_file" ]] || { echo "Missing $env_file (run gen-secrets.sh first)" >&2; exit 1; }

backup_dir="${BACKUP_DIR:-$dir/backups}"
retention="${BACKUP_RETENTION:-7}"
online="${BACKUP_ONLINE:-0}"
workspace_host="$(read_env_var "$env_file" OCM_WORKSPACE_HOST_PATH)"

project="${COMPOSE_PROJECT_NAME:-$(read_env_var "$env_file" COMPOSE_PROJECT_NAME)}"
project="${project:-$(basename "$dir" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')}"
db_volume="${project}_opencode-data"
ws_volume="${project}_opencode-workspace"
timestamp="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$backup_dir"

stopped=0
if [[ "$online" != "1" ]]; then
  echo "Stopping app for a consistent snapshot..."
  docker compose -f "$compose_file" stop app
  stopped=1
  trap 'if [[ "$stopped" == "1" ]]; then docker compose -f "$compose_file" start app; fi' EXIT
fi

echo "Backing up database volume ($db_volume)..."
docker run --rm \
  -v "$db_volume":/data:ro \
  -v "$backup_dir":/backup \
  alpine:3 sh -c "tar czf /backup/db-${timestamp}.tgz -C /data ."

if [[ -n "$workspace_host" ]]; then
  echo "Backing up workspace directory ($workspace_host)..."
  parent="$(dirname "$workspace_host")"
  base="$(basename "$workspace_host")"
  tar czf "$backup_dir/workspace-${timestamp}.tgz" -C "$parent" "$base"
else
  echo "Backing up workspace volume ($ws_volume)..."
  docker run --rm \
    -v "$ws_volume":/data:ro \
    -v "$backup_dir":/backup \
    alpine:3 sh -c "tar czf /backup/workspace-${timestamp}.tgz -C /data ."
fi

prune() {
  local prefix="$1"
  local -a files=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && files+=("$line")
  done < <(ls -1t "$backup_dir"/"$prefix"-*.tgz 2>/dev/null || true)

  if (( ${#files[@]} > retention )); then
    printf '%s\n' "${files[@]:retention}" | xargs -r rm -f
  fi
}
prune db
prune workspace

if [[ "$stopped" == "1" ]]; then
  docker compose -f "$compose_file" start app
  stopped=0
fi

echo "Backup complete:"
ls -lh "$backup_dir" | tail -n +2
