#!/bin/bash
set -e

export HOME=/home/node
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$HOME/.opencode/bin:/usr/local/bin:$PATH"

source /usr/local/lib/ocm/container-user.sh

as_app_user() {
  if [ "$(id -u)" = "0" ]; then
    runuser -u node -- "$@"
  else
    "$@"
  fi
}

MIN_OPENCODE_VERSION="1.0.137"

version_gte() {
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

read_opencode_version() {
  local binary
  binary="$(command -v "${1:-opencode}" 2>/dev/null || true)"
  if [ -z "$binary" ] || [ ! -x "$binary" ]; then
    return 0
  fi
  as_app_user "$binary" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true
}

install_opencode() {
  local opencode_version="${OPENCODE_BUNDLED_VERSION:-}"
  if [ -z "$opencode_version" ]; then
    echo "ERROR: OPENCODE_BUNDLED_VERSION is not set; refusing to guess the pinned OpenCode build" >&2
    return 1
  fi
  if [[ ! "$opencode_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "ERROR: OPENCODE_BUNDLED_VERSION='$opencode_version' is not an X.Y.Z version; refusing to download it" >&2
    return 1
  fi
  if ! version_gte "$opencode_version" "$MIN_OPENCODE_VERSION"; then
    echo "ERROR: OPENCODE_BUNDLED_VERSION=$opencode_version is below the minimum supported $MIN_OPENCODE_VERSION; refusing to download it" >&2
    return 1
  fi
  echo "Installing OpenCode ${opencode_version}..."
  local staging download_base
  download_base="${OPENCODE_DOWNLOAD_BASE:-https://github.com/anomalyco/opencode/releases}"
  staging="$(mktemp -d)"
  curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 20 --max-time 1800 "${download_base}/download/v${opencode_version}/opencode-linux-$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/').tar.gz" \
    -o "$staging/opencode.tar.gz"
  tar -xzf "$staging/opencode.tar.gz" -C "$staging"
  mkdir -p "$HOME/.opencode/bin"
  mv "$staging/opencode" "$HOME/.opencode/bin/opencode"
  chmod 755 "$HOME/.opencode/bin/opencode"
  rm -rf "$staging"
}

reconcile_persisted_opencode() {
  local persisted_path="$HOME/.opencode/bin/opencode"
  [ -e "$persisted_path" ] || return 0
  local persisted_version
  persisted_version="$(read_opencode_version "$persisted_path")"
  if [ -z "$persisted_version" ]; then
    echo "Persisted OpenCode at $persisted_path is malformed or unversioned; removing it to fall back to the bundled binary"
    rm -f "$persisted_path"
    return 0
  fi
  echo "Persisted OpenCode $persisted_version is usable; retaining it"
}

echo "Checking Bun installation..."

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun not found. Installing..."
  curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 20 --max-time 900 https://bun.sh/install | bash

  if ! command -v bun >/dev/null 2>&1; then
    echo "Failed to install Bun. Exiting."
    exit 1
  fi

  echo "Bun installed successfully"
else
  BUN_VERSION=$(bun --version 2>&1 || echo "unknown")
  echo "Bun is installed (version: $BUN_VERSION)"
fi

echo "Checking OpenCode installation..."

reconcile_persisted_opencode

if ! command -v opencode >/dev/null 2>&1; then
  echo "OpenCode not found. Installing..."
  install_opencode

  if ! command -v opencode >/dev/null 2>&1; then
    echo "Failed to install OpenCode. Exiting."
    exit 1
  fi
  echo "OpenCode installed successfully"
fi

OPENCODE_VERSION="$(read_opencode_version)"
[ -n "$OPENCODE_VERSION" ] || OPENCODE_VERSION="unknown"
echo "OpenCode is installed (version: $OPENCODE_VERSION)"

if [ "$OPENCODE_VERSION" != "unknown" ]; then
  if version_gte "$OPENCODE_VERSION" "$MIN_OPENCODE_VERSION"; then
    echo "OpenCode version meets minimum requirement (>=$MIN_OPENCODE_VERSION)"
  else
    echo "OpenCode version $OPENCODE_VERSION is below minimum required version $MIN_OPENCODE_VERSION"
    echo "Reinstalling bundled OpenCode version ${OPENCODE_BUNDLED_VERSION}..."
    install_opencode

    OPENCODE_VERSION="$(read_opencode_version)"
    [ -n "$OPENCODE_VERSION" ] || OPENCODE_VERSION="unknown"
    echo "OpenCode reinstalled as version: $OPENCODE_VERSION"
  fi
fi

echo "Starting OpenCode Manager Backend..."

if [ -z "$AUTH_SECRET" ]; then
  echo "AUTH_SECRET is required but not set"
  echo ""
  echo "Please set AUTH_SECRET environment variable with a secure random string."
  echo "Generate one with: openssl rand -base64 32"
  echo ""
  echo "Example in docker-compose.yml:"
  echo "  environment:"
  echo "    - AUTH_SECRET=your-secure-random-secret-here"
  echo ""
  echo "Example with Docker run:"
  echo "  docker run -e AUTH_SECRET=\$(openssl rand -base64 32) ..."
  echo ""
  exit 1
fi

# Root path: align the container user to PUID/PGID, fix ownership, then drop
# privileges. Non-root path: never call root-only tools; just verify the mounted
# directories are writable by the current user and exec directly.
if [ "$(id -u)" = "0" ]; then
  if ! align_container_user node; then
    exit 1
  fi

  warn_if_workspace_owner_differs /workspace "$OCM_TARGET_UID" "$OCM_TARGET_GID"

  mkdir -p /app/data /workspace /home/node/.cache /home/node/.opencode
  chown -R node:node /app/data /workspace /home/node

  exec runuser -u node -- "$@"
fi

require_writable_dir() {
  local dir="$1"
  if ! mkdir -p "$dir" 2>/dev/null || [ ! -w "$dir" ]; then
    echo "ERROR: $dir is not writable by uid $(id -u)." >&2
    echo "ERROR: the container is running as a non-root user (PUID/PGID)." >&2
    echo "ERROR: ensure the host workspace/data directories are owned by that uid:gid," >&2
    echo "ERROR: or run the container as root to let the entrypoint chown them once." >&2
    exit 1
  fi
}

require_writable_dir /app/data
require_writable_dir /workspace
require_writable_dir /home/node/.cache
require_writable_dir /home/node/.opencode

exec "$@"
