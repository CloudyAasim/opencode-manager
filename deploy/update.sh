#!/usr/bin/env bash
# Update an existing deployment: optional git pull, backup, rebuild, restart.
#
#   ./update.sh                 # backup + rebuild + restart
#   ./update.sh --pull          # also run `git pull --ff-only` first
#   ./update.sh --no-backup     # skip the pre-update backup
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$dir/.." && pwd)"
compose_file="$dir/docker-compose.prod.yml"
compose=(docker compose -f "$compose_file")

do_pull=0
do_backup=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull) do_pull=1; shift ;;
    --no-backup) do_backup=0; shift ;;
    -h|--help) echo "Usage: ./update.sh [--pull] [--no-backup]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -f "$dir/.env" ]] || { echo "No deploy/.env found; run install.sh first" >&2; exit 1; }

if [[ "$do_pull" == "1" ]]; then
  echo "==> Pulling latest source"
  git -C "$repo_root" pull --ff-only
fi

if [[ "$do_backup" == "1" ]]; then
  echo "==> Backing up before update"
  "$dir/backup.sh"
fi

echo "==> Rebuilding and restarting"
"${compose[@]}" up -d --build

echo "==> Waiting for health"
healthy=0
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' opencode-manager 2>/dev/null || echo missing)"
  if [[ "$status" == "healthy" ]]; then healthy=1; break; fi
  sleep 5
done

if [[ "$healthy" != "1" ]]; then
  echo "App did not become healthy; check: docker compose -f $compose_file logs app" >&2
  exit 1
fi

echo "==> Update complete"
if [[ -x "$dir/smoke-test.sh" ]]; then
  "$dir/smoke-test.sh" || echo "Smoke test reported issues; review the output above" >&2
fi
