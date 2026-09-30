#!/usr/bin/env bash

set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

NODE_COMMAND="$(command -v node || true)"
if [[ -z "$NODE_COMMAND" ]] || ! NODE_VERSION="$("$NODE_COMMAND" --version 2>/dev/null)"; then
  CODEX_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  if [[ ! -x "$CODEX_NODE" ]]; then
    echo "Node.js 20+ for this processor architecture is required."
    exit 1
  fi
  NODE_COMMAND="$CODEX_NODE"
  export PATH="$(dirname "$NODE_COMMAND"):$PATH"
fi

if command -v npm >/dev/null 2>&1; then
  exec npm run dev
fi
echo "npm is required. Install a Node.js distribution that includes npm."
exit 1
