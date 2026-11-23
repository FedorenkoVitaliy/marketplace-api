#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
IMAGE=marketplace-api:hw28
docker image inspect "$IMAGE" >/dev/null
if kind get clusters 2>/dev/null | grep -qx hw28; then
  echo "кластер hw28 уже є"
else
  kind create cluster --name hw28 --config k8s/kind-config.yaml
fi
kind load docker-image "$IMAGE" --name hw28
kubectl --context kind-hw28 wait --for=condition=Ready node --all --timeout=180s
kubectl --context kind-hw28 get nodes
