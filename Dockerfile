# syntax=docker/dockerfile:1

# Lean runtime base. The `-slim` variant avoids the ~1.5 GB of build toolchains
# in node:24-trixie while keeping everything the app needs at runtime.
FROM node:24.21.0-trixie-slim AS base

# Debian and npm mirrors are configured inside the image only; the host is never
# modified. Override with --build-arg for the upstream defaults.
ARG DEBIAN_MIRROR=mirrors.ustc.edu.cn
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV npm_config_registry=${NPM_REGISTRY} \
    COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
RUN set -eux; \
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
      if [ -f "$f" ]; then sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" "$f"; fi; \
    done

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    unzip \
    util-linux \
    lsof \
    ripgrep \
    grep \
    gawk \
    sed \
    findutils \
    coreutils \
    procps \
    jq \
    less \
    tree \
    file \
    python3 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

RUN curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 20 --max-time 900 https://bun.sh/install | bash && \
    mv /root/.bun /opt/bun && \
    chmod -R 755 /opt/bun && \
    ln -s /opt/bun/bin/bun /usr/local/bin/bun

WORKDIR /app

# Build stage: full (dev) dependencies plus the toolchain needed to compile
# native modules and build the frontend. This stage is discarded from the final
# image, so the toolchain never ships.
FROM base AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN pnpm install --frozen-lockfile

COPY shared ./shared
COPY backend ./backend
COPY frontend/src ./frontend/src
COPY frontend/public ./frontend/public
COPY frontend/plugins ./frontend/plugins
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig*.json frontend/components.json frontend/eslint.config.js ./frontend/

RUN pnpm --filter frontend build

# Runtime stage.
FROM base AS runner

ARG UV_VERSION=0.12.7
ARG OPENCODE_VERSION=1.18.31
ARG PLAYWRIGHT_VERSION=1.63.0
ARG TOOLS_CACHEBUST=0
# Browser automation pulls ~1 GB of Chromium system libraries; off by default.
ARG WITH_PLAYWRIGHT=false
# Base URL for OpenCode release downloads; point at a mirror/proxy when GitHub
# release assets are unreachable.
ARG OPENCODE_DOWNLOAD_BASE=https://github.com/anomalyco/opencode/releases

RUN echo "Installing uv=${UV_VERSION} opencode=${OPENCODE_VERSION} (cachebust=${TOOLS_CACHEBUST})" && \
    curl -LsSf --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 20 --max-time 900 https://astral.sh/uv/${UV_VERSION}/install.sh | UV_NO_MODIFY_PATH=1 sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    mv /root/.local/bin/uvx /usr/local/bin/uvx && \
    chmod +x /usr/local/bin/uv /usr/local/bin/uvx && \
    test "$(uv --version | cut -d' ' -f2)" = "${UV_VERSION}" && \
    echo "Downloading opencode ${OPENCODE_VERSION}..." && \
    OC_ARCH=$(uname -m) && \
    if [ "$OC_ARCH" = "aarch64" ]; then OC_ARCH="arm64"; fi && \
    if [ "$OC_ARCH" = "x86_64" ]; then OC_ARCH="x64"; fi && \
    if [ "${OPENCODE_VERSION}" = "latest" ]; then \
        OC_DOWNLOAD_URL="${OPENCODE_DOWNLOAD_BASE}/latest/download/opencode-linux-${OC_ARCH}.tar.gz"; \
    else \
        OC_DOWNLOAD_URL="${OPENCODE_DOWNLOAD_BASE}/download/v${OPENCODE_VERSION}/opencode-linux-${OC_ARCH}.tar.gz"; \
    fi && \
    curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 20 --max-time 1800 "$OC_DOWNLOAD_URL" -o /tmp/opencode.tar.gz && \
    tar -xzf /tmp/opencode.tar.gz -C /tmp && \
    mkdir -p /opt/opencode/bin && \
    mv /tmp/opencode /opt/opencode/bin/opencode && \
    chmod 755 /opt/opencode/bin/opencode && \
    rm -f /tmp/opencode.tar.gz && \
    ln -s /opt/opencode/bin/opencode /usr/local/bin/opencode && \
    echo "opencode ${OPENCODE_VERSION} installed successfully"

RUN if [ "$WITH_PLAYWRIGHT" = "true" ]; then \
      echo "Installing Chromium runtime libraries for playwright=${PLAYWRIGHT_VERSION}" && \
      npx --yes "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium && \
      rm -rf /var/lib/apt/lists/* /root/.npm; \
    else \
      echo "Skipping Playwright Chromium libraries (WITH_PLAYWRIGHT=false)"; \
    fi

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5003
ENV OPENCODE_SERVER_PORT=5551
ENV DATABASE_PATH=/app/data/opencode.db
ENV WORKSPACE_PATH=/workspace
ENV XDG_CACHE_HOME=/home/node/.cache
ENV OPENCODE_BUNDLED_VERSION=${OPENCODE_VERSION}
ENV OPENCODE_DOWNLOAD_BASE=${OPENCODE_DOWNLOAD_BASE}

# Install production dependencies directly in the runtime image (only the
# backend workspace and its dependencies), so no dev tree is copied in.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN pnpm install --prod --frozen-lockfile --filter "backend..." && \
    rm -rf /app/node_modules/.cache

# Source only; never copy node_modules from the build stage.
COPY --from=build /app/shared/src ./shared/src
COPY --from=build /app/backend/src ./backend/src
COPY --from=build /app/backend/scripts ./backend/scripts
COPY --from=build /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/backend/node_modules/@opencode-manager && \
    ln -sfn /app/shared /app/backend/node_modules/@opencode-manager/shared

COPY scripts/lib/container-user.sh /usr/local/lib/ocm/container-user.sh
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

RUN mkdir -p /workspace /app/data /home/node/.cache /home/node/.opencode && \
    chown -R node:node /workspace /app/data /home/node

USER node

EXPOSE 5003

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f "http://localhost:${PORT:-5003}/api/health" || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "backend/src/index.ts"]
