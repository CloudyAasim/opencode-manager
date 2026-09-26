#!/usr/bin/env bash
# Stop (and optionally purge) the deployment.
#
#   ./uninstall.sh            # stop and remove containers, keep data volumes
#   ./uninstall.sh --purge    # also delete database and workspace volumes
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="$dir/docker-compose.prod.yml"
compose=(docker compose -f "$compose_file")

purge=0
assume_yes=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge) purge=1; shift ;;
    -y|--yes) assume_yes=1; shift ;;
    -h|--help) echo "Usage: ./uninstall.sh [--purge] [-y]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ "$purge" == "1" ]]; then
  if [[ "$assume_yes" != "1" ]]; then
    read -r -p "This deletes the database and workspace volumes. Type 'purge' to continue: " reply
    [[ "$reply" == "purge" ]] || { echo "Aborted"; exit 1; }
  fi
  echo "==> Removing containers and volumes"
  "${compose[@]}" down -v
  echo "Purged. The host workspace directory (OCM_WORKSPACE_HOST_PATH) was left untouched."
else
  echo "==> Stopping and removing containers (data volumes preserved)"
  "${compose[@]}" down
fi

echo "Done."
