#!/bin/sh
# Sandboxed shell for the OpenCode Manager web terminal.
#
# Runs inside an unprivileged user + mount namespace (set up by terminal-pty.py)
# and builds a minimal chroot that exposes only the tooling needed to work on the
# user's project. The user's workspace is mounted writable at /workspace; the rest
# of the application filesystem - including /app, the SQLite database, other
# users' data and OpenCode credentials - is not reachable.
#
# Usage: terminal-sandbox.sh <shell> <workspace> [shell-args...]
set -eu

SHELL_BIN="${1:-/bin/bash}"
WORKSPACE="${2:-}"
if [ -z "$WORKSPACE" ]; then
  echo "terminal-sandbox: missing workspace directory" >&2
  exit 64
fi
shift 2

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ocm-sandbox.XXXXXX")"
mount -t tmpfs tmpfs "$ROOT"

mkdir -p "$ROOT/usr" "$ROOT/bin" "$ROOT/sbin" "$ROOT/lib" "$ROOT/lib64" \
         "$ROOT/etc" "$ROOT/opt" "$ROOT/proc" "$ROOT/dev" "$ROOT/tmp" "$ROOT/workspace"

bind_readonly() {
  source_path="$1"
  [ -e "$source_path" ] || return 0
  mkdir -p "$ROOT$source_path"
  mount --rbind "$source_path" "$ROOT$source_path" 2>/dev/null || mount --bind "$source_path" "$ROOT$source_path"
  mount -o remount,bind,ro "$ROOT$source_path"
}

for system_dir in /usr /bin /sbin /lib /lib64 /etc /opt; do
  bind_readonly "$system_dir"
done

mkdir -p "$ROOT/proc" "$ROOT/dev"
mount --rbind /proc "$ROOT/proc" 2>/dev/null || mount --bind /proc "$ROOT/proc"
mount --rbind /dev "$ROOT/dev" 2>/dev/null || mount --bind /dev "$ROOT/dev"

mount -t tmpfs tmpfs "$ROOT/tmp"
mount --bind "$WORKSPACE" "$ROOT/workspace"

export HOME=/workspace
export PWD=/workspace

exec chroot "$ROOT" /bin/sh -c 'cd /workspace 2>/dev/null || true; exec "$0" "$@"' "$SHELL_BIN" "$@"
