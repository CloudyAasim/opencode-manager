#!/bin/sh
# Sandboxed shell for the OpenCode Manager web terminal.
#
# Runs inside an unprivileged user + mount namespace (set up by terminal-pty.py)
# and builds a minimal chroot that exposes only the tooling needed to work on the
# user's project. The user's workspace is mounted writable at /workspace; the rest
# of the application filesystem - including /app, the SQLite database, OpenCode
# credentials and other users' data - is not reachable.
#
# Read-only system directories come for free from the uid mapping: the namespace
# maps root to the app uid (see terminal-pty.py --map-root-user), so the
# root-owned system files appear as an unmapped uid, CAP_DAC_OVERRIDE does not
# apply to them, and the ordinary 0755/0644 permissions deny writes. A bind
# remount to read-only is not an option here because the container root is an
# overlayfs, which rejects read-only remounts.
#
# Usage: terminal-sandbox.sh <shell> <workspace> [shell-args...]
set -eu

SHELL_BIN="${1:-/bin/bash}"
WORKSPACE="${2:-}"
if [ -z "$WORKSPACE" ]; then
  echo "terminal-sandbox: missing workspace directory" >&2
  exit 64
fi
SANDBOX_CWD="${3:-/workspace}"
shift 3

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ocm-sandbox.XXXXXX")"
mount -t tmpfs tmpfs "$ROOT"

bind_system() {
  source_path="$1"
  [ -e "$source_path" ] || return 0
  mkdir -p "$ROOT$source_path"
  mount --rbind "$source_path" "$ROOT$source_path" 2>/dev/null || mount --bind "$source_path" "$ROOT$source_path"
}

for system_dir in /usr /bin /sbin /lib /lib64 /etc /opt; do
  bind_system "$system_dir"
done

mkdir -p "$ROOT/proc" "$ROOT/dev" "$ROOT/tmp" "$ROOT/workspace"
bind_system /proc
bind_system /dev

mount -t tmpfs tmpfs "$ROOT/tmp"
mount --bind "$WORKSPACE" "$ROOT/workspace"

export HOME=/workspace
export PWD=/workspace
export OCM_SANDBOX_CWD="$SANDBOX_CWD"

exec chroot "$ROOT" /bin/sh -c 'cd "${OCM_SANDBOX_CWD:-/workspace}" 2>/dev/null || cd /workspace 2>/dev/null || true; exec "$0" "$@"' "$SHELL_BIN" "$@"
