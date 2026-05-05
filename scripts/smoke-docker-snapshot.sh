#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="llm-pulse:smoke"
CONTAINER_NAME="llm-pulse-snapshot-smoke"
VOLUME_NAME="llm-pulse-snapshot-smoke"
HOST_PORT="43131"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
}

trap cleanup EXIT

cleanup

docker build -t "$IMAGE_TAG" .
docker volume create "$VOLUME_NAME" >/dev/null

docker run --rm -d \
  --name "$CONTAINER_NAME" \
  -e DATABASE_URL="${DATABASE_URL:-postgres://pulse:test@127.0.0.1:1/pulse_test}" \
  -e PULSE_SNAPSHOT_ENABLED=true \
  -e PULSE_SNAPSHOT_PATH=/app/apps/server/data/pulse-snapshot.sqlite \
  -v "$VOLUME_NAME":/app/apps/server/data \
  -p "${HOST_PORT}:43130" \
  "$IMAGE_TAG" >/dev/null

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/status/api/health" >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS "http://127.0.0.1:${HOST_PORT}/status/api/health" >/dev/null

docker stop "$CONTAINER_NAME" >/dev/null

docker run --rm -v "$VOLUME_NAME":/data alpine sh -c "test -s /data/pulse-snapshot.sqlite"

echo "Docker snapshot smoke check passed"
