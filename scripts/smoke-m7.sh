#!/usr/bin/env bash
# smoke-m7.sh -- start port-forward on 18080 (avoid the user's dev proxy on 8080),
# run the M7 Playwright spec, clean up.
set -euo pipefail

pf_log=$(mktemp)
kubectl -n swa-demo port-forward svc/portal 18080:8080 >"$pf_log" 2>&1 &
pf_pid=$!
disown $pf_pid
cleanup() {
  kill "$pf_pid" 2>/dev/null || true
  wait "$pf_pid" 2>/dev/null || true
  rm -f "$pf_log"
}
trap cleanup EXIT

for i in {1..30}; do
  curl -sf http://localhost:18080/healthz >/dev/null 2>&1 && break
  sleep 1
done
curl -sf http://localhost:18080/healthz >/dev/null || {
  echo 'port-forward never became ready'; cat "$pf_log"; exit 1
}

( cd ui-tests && BASE_URL=http://localhost:18080 npx playwright test smoke-m7.spec.ts )
