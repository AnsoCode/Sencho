#!/bin/sh
set -e

# Resolve the data directory, mirroring DatabaseService.ts logic.
DATA_DIR="${DATA_DIR:-/app/data}"

# If running as root (the default Docker container start), fix volume ownership,
# fix Docker socket group access, then drop privileges before executing the app.
#
# This is the industry-standard pattern used by the official PostgreSQL, Redis,
# and MariaDB Docker images, and by Docker management tools like Portainer and
# Dockge that also require access to /var/run/docker.sock as a non-root user.
#
# The UID guard also ensures compatibility with strict environments like
# Kubernetes (runAsNonRoot: true) or OpenShift, where the container is forced to
# run as a random high UID. In that case both blocks are skipped and the app
# exec's directly without crashing.
if [ "$(id -u)" = '0' ]; then

    # 1. Fix data volume ownership.
    # Handles host volumes previously created by root or a different UID, which
    # would cause SQLITE_READONLY errors when the non-root sencho user starts.
    # Only touches files with wrong user OR group (efficient on large dirs).
    mkdir -p "$DATA_DIR"
    find "$DATA_DIR" \( \! -user sencho -o \! -group sencho \) \
        -exec chown sencho:sencho '{}' +
    echo "[entrypoint] Data directory ownership ensured: $DATA_DIR"

    # 2. Fix Docker socket group access.
    # The Docker socket on the host is owned by the host's docker group, whose
    # GID varies by Linux distribution and does not match any group inside the
    # container by default.
    if [ -S /var/run/docker.sock ]; then
        DOCKER_SOCK_GID=$(stat -c '%g' /var/run/docker.sock)
        DOCKER_SOCK_MODE=$(stat -c '%a' /var/run/docker.sock)
        echo "[entrypoint] Docker socket found: GID=$DOCKER_SOCK_GID mode=$DOCKER_SOCK_MODE"

        if [ "$DOCKER_SOCK_GID" = "0" ]; then
            echo "[entrypoint] WARNING: Docker socket is root:root -- adding sencho to root group"
            addgroup sencho root 2>/dev/null || true
        else
            if ! getent group "$DOCKER_SOCK_GID" > /dev/null 2>&1; then
                addgroup -S -g "$DOCKER_SOCK_GID" docker-host
                echo "[entrypoint] Created group docker-host with GID $DOCKER_SOCK_GID"
            fi
            DOCKER_GROUP=$(getent group "$DOCKER_SOCK_GID" | cut -d: -f1)
            addgroup sencho "$DOCKER_GROUP" 2>/dev/null || true
            echo "[entrypoint] Added sencho to group '$DOCKER_GROUP' (GID $DOCKER_SOCK_GID)"
        fi
    else
        echo "[entrypoint] WARNING: /var/run/docker.sock not found -- Docker features unavailable"
    fi

    echo "[entrypoint] Dropping privileges to sencho (uid=$(id -u sencho))"

    # 3. Drop privileges.
    # Replace this shell with su-exec so Node becomes PID 1 and receives
    # SIGTERM/SIGINT directly. su-exec calls getgrouplist() for named users,
    # so all supplementary groups added above are inherited by the process.
    exec su-exec sencho "$@"
fi

exec "$@"
