#!/bin/sh
set -eu

# Railway mounts volumes after the image is built, so the /data ownership set in
# the Dockerfile is hidden by the root-owned mount. This volume is dedicated to
# encrypted browser sessions and is the only path this entrypoint may modify.
if [ "$(id -u)" -eq 0 ]; then
  chown -R nodejs:nodejs /data
  chmod 0700 /data
  umask 077
  exec gosu nodejs "$@"
fi

# Preserve compatibility with runtimes that explicitly select the non-root UID.
exec "$@"
