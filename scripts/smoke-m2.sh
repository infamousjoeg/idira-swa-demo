#!/usr/bin/env bash
# smoke-m2.sh — M2 acceptance check (spec §14.2).
#
# Verifies the carrier service is up, reachable from the portal pod, and
# completes the full identity round-trip:
#
#   JWT-SVID (workload api)  →  SM authn-jwt token (Accept-Encoding: base64)
#   →  variable fetch (Authorization: Token token="…")  →  shipment JSON
#
# Exit codes:
#   0  every check ok  ("M2 smoketest PASS.")
#   1  one or more checks failed
#
# M3 change: the carrier now requires mTLS on :8443 and the portal-stub curl
# pod has been retired. Smoketest goes through portal's :8080/resolve which
# wraps the mTLS call to carrier internally. Portal multiplexes its own +
# carrier trace events, so /trace events arrive via portal :8080/trace.
#
# Like smoke-m1.sh, time-sensitive checks (rollout readiness, log scraping
# after the first /resolve) get bounded retries so that hot-cluster runs and
# clean-slate runs both pass.
set -euo pipefail

ns=swa-demo
fail=0

step() { printf '\n== %s ==\n' "$*"; }
ok()   { printf '  [ok]   %s\n' "$*"; }
err()  { printf '  [FAIL] %s\n' "$*"; fail=$((fail+1)); }

# retry CMD MAX_TRIES SLEEP_SEC — run CMD until exit 0 or MAX_TRIES reached.
retry() {
  local max=$1 sleep_s=$2; shift 2
  local i
  for ((i=1; i<=max; i++)); do
    if "$@"; then return 0; fi
    sleep "$sleep_s"
  done
  return 1
}

# Port-forward portal :8080 → localhost. Background, cleaned up on exit.
pf_log=$(mktemp)
kubectl -n "$ns" port-forward svc/portal 8080:8080 >"$pf_log" 2>&1 &
pf_pid=$!
trap 'kill $pf_pid 2>/dev/null || true; rm -f $pf_log; true' EXIT

step 'carrier deployment ready'
if retry 20 3 bash -c '[[ "$(kubectl -n '"$ns"' get deploy carrier -o jsonpath="{.status.readyReplicas}" 2>/dev/null)" == "1" ]]'; then
  ok 'readyReplicas=1'
else
  err "carrier not ready after 60s — readyReplicas=$(kubectl -n $ns get deploy carrier -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo missing)"
fi

step 'portal deployment ready'
if retry 20 3 bash -c '[[ "$(kubectl -n '"$ns"' get deploy portal -o jsonpath="{.status.readyReplicas}" 2>/dev/null)" == "1" ]]'; then
  ok 'readyReplicas=1'
else
  err "portal not ready after 60s — readyReplicas=$(kubectl -n $ns get deploy portal -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo missing)"
fi

step 'portal port-forward reachable'
if retry 20 1 curl -sf --max-time 2 http://localhost:8080/healthz; then
  ok 'http://localhost:8080/healthz OK'
else
  err "portal port-forward never came up — pf_log: $(head -c 400 "$pf_log")"
fi

step 'portal /resolve drives mTLS → JWT-SVID → SM → secret → fixture round-trip'
lookup_body=''
if retry 10 3 bash -c '
  out=$(curl -sf --max-time 15 -X POST \
    -H "Content-Type: application/json" \
    -d "{\"shipment_id\":\"SHP-2049-883\"}" \
    http://localhost:8080/resolve 2>&1) || exit 1
  echo "$out" | jq -e ".shipment_id == \"SHP-2049-883\"" >/dev/null
' ; then
  lookup_body=$(curl -sf --max-time 15 -X POST \
    -H "Content-Type: application/json" \
    -d '{"shipment_id":"SHP-2049-883"}' \
    http://localhost:8080/resolve 2>/dev/null || echo '')
  ok "shipment JSON returned (id, origin, eta present): $(printf %s "$lookup_body" | jq -c '{id:.shipment_id,origin:.origin,eta:.eta}')"
else
  err "lookup failed — last body: $(curl -s --max-time 15 -X POST -H 'Content-Type: application/json' -d '{"shipment_id":"SHP-2049-883"}' http://localhost:8080/resolve 2>&1 | head -c 400)"
fi

step 'error path: 404 on unknown shipment'
http=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST -H 'Content-Type: application/json' \
  -d '{"shipment_id":"SHP-DOES-NOT-EXIST"}' \
  http://localhost:8080/resolve 2>/dev/null || echo 000)
# Portal proxies the carrier status code straight back, so we expect 404.
if [[ "$http" == "404" ]]; then
  ok '404 on miss'
else
  err "expected 404, got $http"
fi

step '/trace endpoint emits full identity round-trip during a /resolve'
# Background a /trace subscriber for a few seconds, kick a happy-path /resolve,
# then check that the subscriber captured every event in the round-trip.
# Carrier events flow into portal's bus via the mTLS trace subscription and
# arrive on the wire wrapped as `carrier.event.raw` frames whose payload.frame
# is the original JSON event — so grep for the expected type strings inside
# the frame value, not as top-level type=.
trace_out=$(mktemp)
# Note: do NOT wrap in `( ... & )` — the subshell hides $! from us and we'd
# end up killing the port-forward instead of this curl.
curl -sN --max-time 8 http://localhost:8080/trace >"$trace_out" 2>/dev/null &
sub_pid=$!
sleep 1
curl -sf --max-time 6 -X POST -H 'Content-Type: application/json' \
  -d '{"shipment_id":"SHP-2049-884"}' \
  http://localhost:8080/resolve >/dev/null 2>&1 || true
sleep 4
kill $sub_pid 2>/dev/null || true
wait $sub_pid 2>/dev/null || true

for evt in 'jwt_svid.issued' 'sm.authn_jwt.ok' 'sm.secret_fetched.ok' 'carrier.lookup.ok'; do
  if grep -q "$evt" "$trace_out"; then
    ok "saw $evt"
  else
    err "missing $evt in /trace stream"
  fi
done
rm -f "$trace_out"

step 'unit tests still pass'
if ( cd apps/carrier && go test ./... >/dev/null 2>&1 ); then
  ok 'carrier go test ./...'
else
  err 'carrier unit tests failed (run `cd apps/carrier && go test -v ./...` for details)'
fi

echo
if (( fail == 0 )); then
  echo 'M2 smoketest PASS.'
  exit 0
else
  echo "M2 smoketest FAIL ($fail check(s) failed)."
  exit 1
fi
