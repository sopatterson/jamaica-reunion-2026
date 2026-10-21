#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if command -v node >/dev/null 2>&1; then
    exec node scripts/apps-script-deploy.mjs "$@"
fi

LOCAL_NODE="$HOME/.local/share/jamaica-reunion-tools/node-v24.22.1-darwin-arm64/bin/node"
if [ ! -x "$LOCAL_NODE" ]; then
    echo "Node.js 20 or newer is required. Install Node.js, then run npm ci." >&2
    exit 1
fi
exec "$LOCAL_NODE" scripts/apps-script-deploy.mjs "$@"
