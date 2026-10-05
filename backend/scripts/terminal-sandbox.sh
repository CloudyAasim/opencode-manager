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

if [ "$#" -lt 3 ]; then
  echo "terminal-sandbox: usage: $0 <shell> <workspace> <sandbox-cwd> [shell-args...]" >&2
  echo "terminal-sandbox: got $# argument(s); refusing to run" >&2
  exit 64
fi

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

# The environment is cleared here, at the last hop, rather than upstream.
# Everything before this line - the backend's own environment, handed down
# through spawn, the bridge and `unshare` - still carries AUTH_SECRET,
# ADMIN_PASSWORD and the OAuth client secrets, and any of them would be visible
# to the person sitting at the prompt with `env` or `cat /proc/self/environ`.
# AUTH_SECRET is better-auth's cookie-signing key, so it is not a disclosure to
# hand it over: it is enough to mint a session for any account, including an
# administrator's, and nothing outside the chroot is needed to use it.
#
# `env -i` clears everything and names only what an interactive shell needs.
# TERM comes from the bridge, which takes it from the browser. Nothing named
# here points outside the chroot.
exec chroot "$ROOT" /bin/sh -c 'cd "${OCM_SANDBOX_CWD:-/workspace}" 2>/dev/null || cd /workspace 2>/dev/null || true; exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/workspace PWD=/workspace SHELL="$0" TERM="${TERM:-xterm-256color}" LANG="${LANG:-C.UTF-8}" "$0" "$@"' "$SHELL_BIN" "$@"
