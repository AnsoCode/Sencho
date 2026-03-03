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
RUN apk add --no-cache docker-cli docker-cli-compose bash

WORKDIR /app

# Copy built backend and node_modules from backend-builder
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=backend-builder /app/backend/node_modules ./node_modules
COPY --from=backend-builder /app/backend/package.json ./

# Copy built frontend from frontend-builder to public folder
COPY --from=frontend-builder /app/frontend/dist ./public

# Set environment to production
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "dist/index.js"]
