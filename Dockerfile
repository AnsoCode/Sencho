# Cross-compilation helper — provides xx-clang, xx-apk, etc.
# Runs on the BUILD platform; its binaries are copied into build stages below.
FROM --platform=$BUILDPLATFORM tonistiigi/xx AS xx

# Stage 1: Build Frontend
# Runs on the BUILD platform (amd64) — frontend has no native modules so the
# compiled output (JS/CSS/HTML) is entirely platform-agnostic.
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5 && \
    npm install

COPY frontend/ ./
RUN npm run build

# Stage 2: Compile TypeScript
# Runs on the BUILD platform (amd64) — tsc output is platform-agnostic JS.
FROM --platform=$BUILDPLATFORM node:20-alpine AS backend-builder

WORKDIR /app/backend

RUN apk add --no-cache python3 make g++

COPY backend/package*.json ./
RUN npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5 && \
    npm install

COPY backend/ ./
RUN npm run build

# Stage 3: Production dependencies (cross-compiled — NO QEMU execution)
# Runs on the BUILD platform (amd64) but compiles native modules
# (bcrypt, better-sqlite3, node-pty) for the TARGET platform using
# tonistiigi/xx + clang as the cross-compiler.
# This avoids the Node.js v20 SIGILL crash that occurs when npm runs
# under QEMU because QEMU lacks ARMv8.1 LSE atomic instruction support.
FROM --platform=$BUILDPLATFORM node:20-alpine AS prod-deps

# Copy xx cross-compilation tools into this stage
COPY --from=xx / /

ARG TARGETPLATFORM
ARG TARGETARCH

WORKDIR /app

# Host tools (run natively on amd64):
#   clang lld  — LLVM cross-compiler + linker used by xx-clang/xx-clang++
#   python3 make g++  — required by node-gyp to drive the native build system
#
# Target sysroot (installed for the TARGET arch by xx-apk):
#   g++          — libstdc++ headers/libs; all three native modules use C++
#   musl-dev     — musl libc headers needed for any C/C++ target compilation
#   linux-headers — <pty.h> / <termios.h> required by node-pty
RUN apk add --no-cache clang lld python3 make g++ && \
    xx-apk add --no-cache g++ musl-dev linux-headers

COPY backend/package*.json ./

# npm_config_arch=$TARGETARCH → tells prebuild-install / node-pre-gyp which
#   pre-built binary to attempt (arm64 vs amd64). Falls back to source build.
# CC/CXX=xx-clang(++) → LLVM cross-compiler targeting $TARGETPLATFORM.
# AR=xx-ar → cross-archiver; without it node-gyp uses the host ar (amd64)
#   and produces wrong-arch static libraries that fail to link.
RUN npm_config_arch=$TARGETARCH \
    CC=xx-clang \
    CXX=xx-clang++ \
    AR=xx-ar \
    npm ci --omit=dev

# Stage 4: Production runtime
# Runs on the TARGET platform — no compilation happens here.
FROM node:20-alpine

# Install Docker CLI, Docker Compose CLI, and Bash for Host Console
RUN apk add --no-cache docker-cli docker-cli-compose bash su-exec

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

# Create a non-root user and ensure the data/compose directories are writable.
# The actual volume paths are mounted at runtime, so we only pre-create the
# default data dir here; the compose dir is user-supplied via COMPOSE_DIR.
RUN addgroup -S sencho && adduser -S -G sencho sencho \
  && mkdir -p /app/data \
  && chown -R sencho:sencho /app

# Copy the entrypoint script that fixes data-volume ownership at startup and
# then drops privileges to the sencho user via su-exec (the idiomatic Alpine
# equivalent of gosu). This mirrors the pattern used by official Docker images
# such as PostgreSQL, Redis, and MariaDB.
#
# NOTE: USER directive is intentionally absent here. The entrypoint starts as
# root so it can chown the mounted data volume, then exec's as sencho. Static
# security scanners (Trivy, Clair) may flag "running as root" — this is a known
# and accepted trade-off for self-hosted apps with user-supplied volume mounts.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Strip Windows CRLF line endings that can sneak in on Windows dev machines
# even with .gitattributes eol=lf, then make executable. A shell script with
# \r in tokens like "fi\r" will fail with "unexpected end of file" in Alpine.
RUN sed -i 's/\r//' /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Health check — polls the public /api/health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const h=require('http');h.get('http://localhost:3000/api/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# Entrypoint fixes volume ownership as root then drops to sencho via su-exec.
# CMD provides the default arguments passed through to the entrypoint.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
