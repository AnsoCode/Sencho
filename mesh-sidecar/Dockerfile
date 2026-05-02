# Multi-stage build for the Sencho Mesh sidecar.
#
# Base image is pinned by digest, not tag, so a future republish of the
# `22-alpine` tag cannot silently shift the runtime under a release. Update
# the digest in the same PR that rolls the Node minor or upgrades from
# alpine. Resolve a fresh digest with:
#   docker buildx imagetools inspect node:22-alpine
ARG NODE_BASE=node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f

FROM ${NODE_BASE} AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM ${NODE_BASE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist

# No HEALTHCHECK: the sidecar has no inbound HTTP listener. It maintains
# an outbound websocket to the control plane and exits on connection loss
# so Docker's restart policy is the natural recovery loop. A liveness
# probe based on the node process being PID 1 would be tautological.

USER node
CMD ["node", "dist/index.js"]
