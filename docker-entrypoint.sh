#!/bin/sh
set -e

# Resolve the data directory, mirroring DatabaseService.ts logic.
DATA_DIR="${DATA_DIR:-/app/data}"

# Sencho runs as root by default inside the container. It needs access to
# /var/run/docker.sock (which is equivalent to root on the host regardless
# of the user Sencho itself runs as) and to user-supplied bind mounts that
# containers in those stacks commonly chown to arbitrary UIDs. Running as
# root is the same posture used by Portainer, Dockge, Komodo, and Yacht.
#
# Users who need the container to drop privileges (organisational policy,
# compliance scanners, rootless Docker with UID mapping) can set
# SENCHO_USER=sencho at runtime to opt into the legacy non-root mode. The
# opt-out path does all the work the old entrypoint used to do: fix data
# volume ownership, match the Docker socket GID, and exec via su-exec.
#
# The "id -u = 0" guard keeps Kubernetes / OpenShift forced-non-root
# deployments (runAsNonRoot: true with a random high UID) working: the
# entire setup block is skipped and the app exec's directly.
if [ "$(id -u)" = '0' ]; then

    mkdir -p "$DATA_DIR"
    # Restrict encryption key to owner-only access regardless of runtime user.
    [ -f "$DATA_DIR/encryption.key" ] && chmod 600 "$DATA_DIR/encryption.key"

    if [ -n "$SENCHO_USER" ]; then
        # Fail fast if the opted-in user does not exist inside the container.
        # Without this, the su-exec call below would error out with a cryptic
        # "su-exec: getpwnam($SENCHO_USER): No such file or directory" and the
        # operator would have no hint that the variable itself is the cause.
        if ! id "$SENCHO_USER" >/dev/null 2>&1; then
            echo "[entrypoint] ERROR: SENCHO_USER=$SENCHO_USER does not exist inside the container." >&2
            echo "[entrypoint] Use 'sencho' (pre-created) or unset SENCHO_USER to run as root." >&2
            exit 1
        fi

        # Re-own the data dir so SQLite and the encryption key are readable
        # after the privilege drop. `|| true` tolerates a read-only /app/data
        # (rare but possible with some bind-mount configurations); chown
        # errors still surface in the log so operators see them.
        find "$DATA_DIR" \( \! -user "$SENCHO_USER" -o \! -group "$SENCHO_USER" \) \
            -exec chown "$SENCHO_USER:$SENCHO_USER" '{}' + || true

        # Match the Docker socket GID so the dropped user can reach Docker.
        if [ -S /var/run/docker.sock ]; then
            DOCKER_SOCK_GID=$(stat -c '%g' /var/run/docker.sock)
            if [ "$DOCKER_SOCK_GID" = "0" ]; then
                addgroup "$SENCHO_USER" root 2>/dev/null || true
            else
                if ! getent group "$DOCKER_SOCK_GID" > /dev/null 2>&1; then
                    addgroup -S -g "$DOCKER_SOCK_GID" docker-host
                fi
                DOCKER_GROUP=$(getent group "$DOCKER_SOCK_GID" | cut -d: -f1)
                addgroup "$SENCHO_USER" "$DOCKER_GROUP" 2>/dev/null || true
            fi
        fi

        echo "[entrypoint] SENCHO_USER=$SENCHO_USER set; dropping privileges."
        exec su-exec "$SENCHO_USER" "$@"
    fi

    echo "[entrypoint] Running as root. Set SENCHO_USER=sencho to drop privileges."
fi

exec "$@"
