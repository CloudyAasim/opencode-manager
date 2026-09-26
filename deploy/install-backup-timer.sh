#!/usr/bin/env bash
# Install a daily backup schedule (systemd timer when available, cron otherwise).
#
#   sudo ./install-backup-timer.sh --hour 3
#   ./install-backup-timer.sh --dry-run
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backup_script="$dir/backup.sh"

hour=3
minute=0
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hour) hour="${2:-}"; shift 2 ;;
    --minute) minute="${2:-}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) echo "Usage: ./install-backup-timer.sh [--hour N] [--minute N] [--dry-run]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -x "$backup_script" ]] || { echo "backup.sh is not executable" >&2; exit 1; }

run() {
  if [[ "$dry_run" == "1" ]]; then
    echo "+ $*"
  else
    "$@"
  fi
}

if command -v systemctl >/dev/null 2>&1 && [[ "$(id -u)" == "0" ]]; then
  service=/etc/systemd/system/opencode-manager-backup.service
  timer=/etc/systemd/system/opencode-manager-backup.timer

  echo "==> Installing systemd timer (daily at ${hour}:$(printf '%02d' "$minute"))"
  if [[ "$dry_run" == "1" ]]; then
    echo "+ write $service"
    echo "+ write $timer"
    echo "+ systemctl daemon-reload && systemctl enable --now opencode-manager-backup.timer"
  else
    cat > "$service" <<EOF
[Unit]
Description=OpenCode Manager backup

[Service]
Type=oneshot
Environment=BACKUP_ONLINE=1
ExecStart=/bin/bash ${backup_script}
EOF
    cat > "$timer" <<EOF
[Unit]
Description=Daily OpenCode Manager backup

[Timer]
OnCalendar=*-*-* ${hour}:$(printf '%02d' "$minute"):00
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now opencode-manager-backup.timer
  fi
  echo "Installed. Inspect with: systemctl list-timers opencode-manager-backup.timer"
else
  cron_line="${minute} ${hour} * * * BACKUP_ONLINE=1 /bin/bash ${backup_script} >> ${dir}/backups/cron.log 2>&1 # opencode-manager-backup"
  echo "==> Installing user cron entry"
  echo "    ${cron_line}"
  if [[ "$dry_run" == "1" ]]; then
    echo "+ crontab entry (not written)"
  else
    mkdir -p "$dir/backups"
    { crontab -l 2>/dev/null | grep -v 'opencode-manager-backup' || true; echo "$cron_line"; } | crontab -
  fi
  echo "Installed. Inspect with: crontab -l"
fi
