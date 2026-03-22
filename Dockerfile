# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5 && \
    npm install

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN npm run build

# Stage 2: Build Backend
FROM node:20-alpine AS backend-builder

WORKDIR /app/backend

# Install build dependencies for node-pty native modules
RUN apk add --no-cache python3 make g++

# Copy backend package files
COPY backend/package*.json ./

# Install dependencies
RUN npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5 && \
    npm install

# Copy backend source
COPY backend/ ./

# Build backend
RUN npm run build

# Stage 3: Production
FROM node:20-alpine

# Install Docker CLI, Docker Compose CLI, and Bash for Host Console
RUN apk add --no-cache docker-cli docker-cli-compose bash su-exec

WORKDIR /app

# Copy built backend and node_modules from backend-builder
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=backend-builder /app/backend/node_modules ./node_modules
COPY --from=backend-builder /app/backend/package.json ./

# Copy built frontend from frontend-builder to public folder
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
