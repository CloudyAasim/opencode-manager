#!/usr/bin/env bash
# Restore the OpenCode Manager database volume and/or workspace from backups
# produced by backup.sh.
#
# Usage:
#   ./restore.sh --db backups/db-20260101-120000.tgz [--workspace backups/workspace-20260101-120000.tgz] [--yes]
#
# WARNING: restore replaces existing data. Pass --yes for non-interactive use.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="$dir/docker-compose.prod.yml"
env_file="$dir/.env"
# shellcheck source=lib.sh
source "$dir/lib.sh"

db_archive=""
ws_archive=""
assume_yes=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db) db_archive="${2:-}"; shift 2 ;;
    --workspace) ws_archive="${2:-}"; shift 2 ;;
    --yes|-y) assume_yes=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$db_archive" && -z "$ws_archive" ]]; then
  echo "Provide --db and/or --workspace" >&2; exit 1
fi
[[ -f "$env_file" ]] || { echo "Missing $env_file" >&2; exit 1; }

workspace_host="$(read_env_var "$env_file" OCM_WORKSPACE_HOST_PATH)"
puid="$(read_env_var "$env_file" PUID)"
pgid="$(read_env_var "$env_file" PGID)"
project="${COMPOSE_PROJECT_NAME:-$(read_env_var "$env_file" COMPOSE_PROJECT_NAME)}"
project="${project:-$(basename "$dir" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')}"
db_volume="${project}_opencode-data"
ws_volume="${project}_opencode-workspace"
owner="${puid:-1000}:${pgid:-1000}"

if [[ "$assume_yes" != "1" ]]; then
  echo "This will OVERWRITE existing data with:"
  [[ -n "$db_archive" ]] && echo "  database : $db_archive"
  [[ -n "$ws_archive" ]] && echo "  workspace: $ws_archive"
  read -r -p "Type 'restore' to continue: " reply
  [[ "$reply" == "restore" ]] || { echo "Aborted"; exit 1; }
fi

echo "Stopping app..."
docker compose -f "$compose_file" stop app

if [[ -n "$db_archive" ]]; then
  [[ -f "$db_archive" ]] || { echo "Database archive not found: $db_archive" >&2; exit 1; }
  db_dir="$(cd "$(dirname "$db_archive")" && pwd)"
  db_name="$(basename "$db_archive")"
  echo "Restoring database volume..."
  docker run --rm \
    -v "$db_volume":/data \
    -v "$db_dir":/backup:ro \
    alpine:3 sh -c "find /data -mindepth 1 -delete && tar xzf /backup/${db_name} -C /data && chown -R ${owner} /data"
fi

if [[ -n "$ws_archive" ]]; then
  [[ -f "$ws_archive" ]] || { echo "Workspace archive not found: $ws_archive" >&2; exit 1; }
  if [[ -n "$workspace_host" ]]; then
    echo "Restoring workspace directory..."
    parent="$(dirname "$workspace_host")"
    base="$(basename "$workspace_host")"
    rm -rf "${workspace_host:?}"
    mkdir -p "$parent"
    tar xzf "$ws_archive" -C "$parent"
    chown -R "$owner" "$workspace_host" 2>/dev/null || true
    echo "Restored $base"
  else
    ws_dir="$(cd "$(dirname "$ws_archive")" && pwd)"
    ws_name="$(basename "$ws_archive")"
    echo "Restoring workspace volume..."
    docker run --rm \
      -v "$ws_volume":/data \
      -v "$ws_dir":/backup:ro \
      alpine:3 sh -c "find /data -mindepth 1 -delete && tar xzf /backup/${ws_name} -C /data && chown -R ${owner} /data"
  fi
fi

echo "Starting app..."
docker compose -f "$compose_file" start app
echo "Restore complete."
