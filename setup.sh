#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "🚀 Setting up Restaurant AI application..."

NODE_COMMAND="$(command -v node || true)"
if [[ -z "$NODE_COMMAND" ]] || ! NODE_VERSION="$("$NODE_COMMAND" --version 2>/dev/null)"; then
  CODEX_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  if [[ -x "$CODEX_NODE" ]] && NODE_VERSION="$($CODEX_NODE --version 2>/dev/null)"; then
    NODE_COMMAND="$CODEX_NODE"
    export PATH="$(dirname "$NODE_COMMAND"):$PATH"
    echo "ℹ️ Using the compatible Node runtime bundled with Codex."
  else
    echo "❌ Node.js is missing or cannot run on this computer. Install Node.js 20+ for your processor architecture."
    exit 1
  fi
fi

NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if (( NODE_MAJOR < 20 )); then
  echo "❌ Node.js 20 or newer is required; found $NODE_VERSION."
  exit 1
fi
echo "✅ Node: $NODE_VERSION"

if command -v npm >/dev/null 2>&1; then
  PACKAGE_MANAGER="npm"
elif command -v pnpm >/dev/null 2>&1; then
  PACKAGE_MANAGER="pnpm"
else
  echo "❌ Install pnpm or npm to install project dependencies."
  exit 1
fi

echo "📦 Installing workspace dependencies with $PACKAGE_MANAGER..."
if [[ "$PACKAGE_MANAGER" == "pnpm" ]]; then
  pnpm install
else
  npm install
fi

echo "🔴 Checking Redis..."
if "$ROOT_DIR/redis-local.sh"; then
  echo "✅ Redis is ready."
else
  echo "⚠️ Start a Redis service or run 'docker compose up -d redis' before the backend."
fi

if [[ ! -f .env ]]; then
  umask 077
  touch .env
  echo "ℹ️ Created an empty .env. Add MongoDB, Redis, JWT, and Groq settings before starting the app."
fi

echo ""
echo "✅ Local dependencies are set up."
echo "Run './dev.sh' after configuring .env and starting MongoDB/Redis."
