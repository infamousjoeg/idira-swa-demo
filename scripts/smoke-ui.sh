#!/usr/bin/env bash
# smoke-ui.sh — start port-forward, run Playwright, clean up.
set -euo pipefail

pf_log=$(mktemp)
kubectl -n swa-demo port-forward svc/portal 8080:8080 >"$pf_log" 2>&1 &
pf_pid=$!
trap 'kill $pf_pid 2>/dev/null || true; rm -f $pf_log; true' EXIT

# Wait for the port-forward to be ready.
for i in {1..30}; do
  curl -sf http://localhost:8080/healthz >/dev/null 2>&1 && break
  sleep 1
done
curl -sf http://localhost:8080/healthz >/dev/null || {
  echo 'port-forward never became ready'; cat "$pf_log"; exit 1
}

( cd ui-tests && BASE_URL=http://localhost:8080 npx playwright test )
