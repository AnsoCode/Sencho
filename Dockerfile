# Cross-compilation helper - provides xx-clang, xx-apk, etc.
# Runs on the BUILD platform; its binaries are copied into build stages below.
FROM --platform=$BUILDPLATFORM tonistiigi/xx AS xx

# Stage 1: Build Frontend
# Runs on the BUILD platform (amd64) - frontend has no native modules so the
# compiled output (JS/CSS/HTML) is entirely platform-agnostic.
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json frontend/.npmrc ./
RUN npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5 && \
    npm install

COPY frontend/ ./
# vite.config.ts reads the root package.json for the app version
COPY package.json /app/package.json
RUN npm run build

# Stage 2: Compile TypeScript
# Runs on the BUILD platform (amd64) - tsc output is platform-agnostic JS.
FROM --platform=$BUILDPLATFORM node:22-alpine AS backend-builder

WORKDIR /app/backend

RUN apk add --no-cache python3 make g++

COPY backend/package*.json backend/.npmrc ./
RUN npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5 && \
    npm install

COPY backend/ ./
# prebuild hook (generate-version.js) reads the root package.json for the app version
COPY package.json /app/package.json
RUN npm run build

# Stage 3: Production dependencies (cross-compiled - NO QEMU execution)
# Runs on the BUILD platform (amd64) but compiles native modules
# (bcrypt, better-sqlite3, node-pty) for the TARGET platform using
# tonistiigi/xx + clang as the cross-compiler.
# This avoids the Node.js v20 SIGILL crash that occurs when npm runs
# under QEMU because QEMU lacks ARMv8.1 LSE atomic instruction support.
FROM --platform=$BUILDPLATFORM node:22-alpine AS prod-deps

# Copy xx cross-compilation tools into this stage
COPY --from=xx / /

ARG TARGETARCH
ARG BUILDARCH

WORKDIR /app

# Two paths depending on whether we are cross-compiling:
#
# Native (TARGETARCH == BUILDARCH, e.g. amd64 → amd64):
#   Standard g++ is used. xx-clang introduces sysroot flags that conflict with
#   node-gyp's header resolution on Alpine for same-platform builds, so we
#   bypass it entirely and let npm ci use the host compiler directly.
#
# Cross (TARGETARCH != BUILDARCH, e.g. amd64 → arm64):
#   xx-clang targets the foreign architecture without QEMU. The target sysroot
#   is populated via xx-apk:
#     g++           - libstdc++ headers/libs (all three native modules use C++)
#     musl-dev      - musl libc headers for the target arch
#     linux-headers - <pty.h> / <termios.h> required by node-pty
RUN if [ "$TARGETARCH" = "$BUILDARCH" ]; then \
      apk add --no-cache python3 make g++; \
    else \
      apk add --no-cache clang lld python3 make g++ && \
      xx-apk add --no-cache g++ musl-dev linux-headers; \
    fi

COPY backend/package*.json backend/.npmrc ./

# Native: plain npm ci - g++ compiles native modules for the host arch.
# Cross:  npm_config_arch tells prebuild-install/node-pre-gyp which pre-built
#         binary to attempt; CC/CXX/AR route compilation through xx-clang so
#         the output targets the foreign arch without any QEMU emulation.
RUN if [ "$TARGETARCH" = "$BUILDARCH" ]; then \
      npm ci --omit=dev; \
    else \
      npm_config_arch=$TARGETARCH \
        CC=xx-clang \
        CXX=xx-clang++ \
        AR=xx-ar \
        npm ci --omit=dev; \
    fi

# Stage 4: Production runtime
# Runs on the TARGET platform - no compilation happens here.
#
# Vulnerability scanning uses the external `trivy` CLI. It is not installed
# in this image; operators who want the feature install Trivy on the host
# and mount the binary into the container, or run a sidecar. See
# docs/operations/trivy-setup.mdx for the supported integration paths.
FROM node:22-alpine

# Pin Docker CLI and Compose versions.
#
# Docker CLI v29.3.1 — compiled with Go 1.25.8, buildkit 0.28.1, x/crypto 0.48.0.
# Fixes: CVE-2026-34040, CVE-2026-33997, CVE-2026-33747, CVE-2026-33748,
#        CVE-2025-68121, CVE-2025-61726, CVE-2025-61729, CVE-2026-25679,
#        CVE-2025-47913.
#
# Compose v5.1.1 — compiled with Go 1.25.8, x/crypto 0.46.0.
# Upgraded from v2.40.3 (Go 1.24.9 / grpc 1.74.2 / x/crypto 0.38.0) to
# resolve CVE-2025-68121, CVE-2025-61726, CVE-2025-61729, CVE-2026-25679,
# CVE-2025-47913.
#
# NOTE: Compose v5.1.2 bumps grpc to 1.80.0 (fixes CVE-2026-33186) and
# Go to 1.25.9 (fixes CVE-2026-32282). Docker CLI 29.4.0 also ships
# with Go 1.25.9+.
ARG DOCKER_VERSION=29.4.0
ARG COMPOSE_VERSION=v5.1.2

# Daily cache-bust for the apk upgrade layer. CI passes the current date
# (YYYY-MM-DD) as a build-arg, so this RUN layer's hash changes at most
# once per calendar day. Without this, buildx reuses the cached layer
# indefinitely and a new Alpine package fix (e.g. an openssl CVE patched
# upstream in alpine 3.23) sits behind the stale cache until an unrelated
# change invalidates this line by coincidence. Default value lets local
# developers build without the arg; production CI always sets it.
ARG APK_CACHE_BUST=unset

# Upgrade all Alpine system packages, install runtime deps, then fetch Docker
# CLI + Compose plugin from official static binaries.
RUN echo "apk cache bust: ${APK_CACHE_BUST}" && \
    apk upgrade --no-cache && \
    apk add --no-cache bash su-exec curl && \
    ARCH=$(uname -m) && \
    curl -fsSL "https://download.docker.com/linux/static/stable/${ARCH}/docker-${DOCKER_VERSION}.tgz" \
      | tar xz -C /usr/local/bin --strip-components=1 docker/docker && \
    mkdir -p /usr/local/lib/docker/cli-plugins && \
    curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
      "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-${ARCH}" && \
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose && \
    apk del curl

WORKDIR /app

# Copy cross-compiled production node_modules from the prod-deps stage
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./

# Copy compiled TypeScript output (platform-agnostic JS)
COPY --from=backend-builder /app/backend/dist ./dist

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./public

# Set environment to production
ENV NODE_ENV=production

# Pre-create the sencho user and group so the SENCHO_USER=sencho opt-out path
# in docker-entrypoint.sh works out of the box. The default runtime is root;
# this user only becomes relevant when an operator explicitly sets
# SENCHO_USER at runtime to drop privileges.
RUN addgroup -S sencho && adduser -S -G sencho sencho \
  && mkdir -p /app/data \
  && chown -R sencho:sencho /app

# Sencho runs as root by default. Docker management tools like Portainer,
# Dockge, Komodo, and Yacht all ship this way because mounting
# /var/run/docker.sock is already equivalent to root-on-host; a non-root
# container user buys essentially no extra isolation while breaking
# filesystem operations against bind mounts that user stacks have chowned.
#
# Operators who need a non-root container (compliance scanners, rootless
# Docker with UID mapping, organisational policy) can set SENCHO_USER=sencho
# at runtime. The entrypoint handles the privilege drop, data-volume
# ownership, and Docker socket GID matching in that path.
#
# USER directive intentionally absent so the entrypoint controls the runtime
# user. Static security scanners (Trivy, Docker Scout) may flag this as
# "running as root" which is the documented and intended default.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Strip Windows CRLF line endings that can sneak in on Windows dev machines
# even with .gitattributes eol=lf, then make executable. A shell script with
# \r in tokens like "fi\r" will fail with "unexpected end of file" in Alpine.
RUN sed -i 's/\r//' /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose port
EXPOSE 1852

# Health check - polls the public /api/health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const h=require('http');h.get('http://localhost:1852/api/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# Entrypoint ensures /app/data is writable and execs the CMD as root by default,
# or drops to $SENCHO_USER via su-exec when that env var is set (see comment above).
# CMD provides the default arguments passed through to the entrypoint.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
