#!/usr/bin/env bash

set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

REDIS_URL_VALUE="${REDIS_URL:-}"
if [[ -z "$REDIS_URL_VALUE" && -f .env ]]; then
  REDIS_URL_VALUE="$(awk -F= '$1 == "REDIS_URL" { sub(/^[^=]*=/, ""); print; exit }' .env)"
fi
if [[ -z "$REDIS_URL_VALUE" ]]; then
  echo "REDIS_URL is missing from .env."
  exit 1
fi
case "$REDIS_URL_VALUE" in
  redis://127.0.0.1:*|redis://localhost:*|redis://127.0.0.1|redis://localhost) ;;
  *) echo "Using the Redis service configured in .env."; exit 0 ;;
esac

REDIS_CLI="$ROOT_DIR/.runtime/redis/bin/redis-cli"
REDIS_SERVER="$ROOT_DIR/.runtime/redis/bin/redis-server"
if [[ ! -x "$REDIS_CLI" ]]; then REDIS_CLI="$(command -v redis-cli || true)"; fi
if [[ -n "$REDIS_CLI" ]] && "$REDIS_CLI" -h 127.0.0.1 -p 6379 ping 2>/dev/null | grep -q PONG; then
  echo "Redis is already running on localhost:6379."
  exit 0
fi

if [[ -x "$REDIS_SERVER" ]]; then
  mkdir -p "$ROOT_DIR/.runtime/data"
  "$REDIS_SERVER" --daemonize yes --bind 127.0.0.1 --port 6379 --protected-mode yes \
    --pidfile "$ROOT_DIR/.runtime/redis.pid" --logfile "$ROOT_DIR/.runtime/redis.log" \
    --dir "$ROOT_DIR/.runtime/data" --save '' --appendonly no
  echo "Started the project-local Redis service."
  exit 0
fi

if command -v redis-server >/dev/null 2>&1; then
  echo "redis-server is installed. Start it on localhost:6379, then rerun this command."
elif command -v docker >/dev/null 2>&1; then
  echo "Redis is not installed. Start Docker Desktop, then run 'docker compose up -d redis'."
else
  echo "Redis is not installed. Install Redis or configure a reachable REDIS_URL in .env."
fi
exit 1
