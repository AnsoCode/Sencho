#!/bin/sh
set -e

# Resolve the data directory, mirroring DatabaseService.ts logic.
DATA_DIR="${DATA_DIR:-/app/data}"

# If running as root (the default Docker container start), fix volume ownership
# then drop privileges before executing the application.
#
# This handles the common case where the host-mounted data volume was created by
# root (or a different UID) from a previous run or backup restore — causing
# SQLITE_READONLY errors when the non-root sencho user tries to write.
#
# This is the industry-standard pattern used by the official PostgreSQL, Redis,
# and MariaDB Docker images.
#
# The UID guard also ensures compatibility with strict environments like
# Kubernetes (runAsNonRoot: true) or OpenShift, where the container is forced to
# run as a random high UID. In that case the chown block is skipped entirely and
# the app exec's directly without crashing.
if [ "$(id -u)" = '0' ]; then
    mkdir -p "$DATA_DIR"

    # Fix files where user OR group is wrong — not just user. This covers the
    # case where a file ends up as sencho:root after a partial previous fix.
    # The -exec '{}' + form batches arguments for efficiency (like xargs).
    find "$DATA_DIR" \( \! -user sencho -o \! -group sencho \) \
        -exec chown sencho:sencho '{}' +

    # Replace this shell process with su-exec so that Node becomes PID 1 and
    # receives SIGTERM/SIGINT directly from Docker. Without exec the shell would
    # intercept signals and the container would hang for 10s before SIGKILL.
    exec su-exec sencho "$@"
fi

exec "$@"
