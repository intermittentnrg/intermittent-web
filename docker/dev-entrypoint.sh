#!/bin/sh
set -eu

cd /workspace

# node_modules is a Docker volume in dev. On a fresh volume, install deps before
# starting the requested command so the container does not immediately fail with
# "tsx: not found" / "tsc: not found".
if [ ! -x node_modules/.bin/tsx ] || [ ! -x node_modules/.bin/tsc ]; then
  echo "node_modules is missing dev tools; running npm install..."
  npm install
fi

exec "$@"
