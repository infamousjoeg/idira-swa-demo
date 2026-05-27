#!/usr/bin/env bash
# smoke-m2.sh — M2 acceptance check (spec §14.2).
#
# Verifies the carrier service is up, reachable from a portal-stub pod, and
# completes the full identity round-trip:
#
#   JWT-SVID (workload api)  →  SM authn-jwt token (Accept-Encoding: base64)
#   →  variable fetch (Authorization: Token token="…")  →  shipment JSON
#
# Exit codes:
#   0  every check ok  ("M2 smoketest PASS.")
#   1  one or more checks failed
#
# Like smoke-m1.sh, time-sensitive checks (rollout readiness, log scraping
# after the first /lookup) get bounded retries so that hot-cluster runs and
# clean-slate runs both pass.
set -euo pipefail

ns=swa-demo
carrier_url='http://carrier.swa-demo.svc.cluster.local:8443'
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

step 'carrier deployment ready'
if retry 20 3 bash -c '[[ "$(kubectl -n '"$ns"' get deploy carrier -o jsonpath="{.status.readyReplicas}" 2>/dev/null)" == "1" ]]'; then
  ok 'readyReplicas=1'
else
  err "carrier not ready after 60s — readyReplicas=$(kubectl -n $ns get deploy carrier -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo missing)"
fi

step 'portal-stub pod ready'
if retry 20 3 bash -c '[[ "$(kubectl -n '"$ns"' get pod portal-stub -o jsonpath="{.status.phase}" 2>/dev/null)" == "Running" ]]'; then
  ok 'Running'
else
  err "portal-stub not Running after 60s — phase=$(kubectl -n $ns get pod portal-stub -o jsonpath='{.status.phase}' 2>/dev/null || echo missing)"
fi

step 'portal-stub can reach carrier and resolve a shipment'
# --max-time 15 is the per-request bound; outer retry covers transient DNS or
# pod-not-quite-ready races right after rollout.
lookup_body=''
if retry 10 3 bash -c '
  out=$(kubectl -n '"$ns"' exec portal-stub -- curl -sf --max-time 15 \
    '"$carrier_url"'/lookup/SHP-2049-883 2>&1) || exit 1
  echo "$out" | jq -e ".shipment_id == \"SHP-2049-883\"" >/dev/null
' ; then
  lookup_body=$(kubectl -n $ns exec portal-stub -- curl -sf --max-time 15 \
    "$carrier_url/lookup/SHP-2049-883" 2>/dev/null || echo '')
  ok "shipment JSON returned (id, origin, eta present): $(printf %s "$lookup_body" | jq -c '{id:.shipment_id,origin:.origin,eta:.eta}')"
else
  err "lookup failed — last body: $(kubectl -n $ns exec portal-stub -- curl -s --max-time 15 "$carrier_url/lookup/SHP-2049-883" 2>&1 | head -c 400)"
fi

step 'error path: 404 on unknown shipment'
http=$(kubectl -n $ns exec portal-stub -- curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  "$carrier_url/lookup/SHP-DOES-NOT-EXIST" 2>/dev/null || echo 000)
if [[ "$http" == "404" ]]; then
  ok '404 on miss'
else
  err "expected 404, got $http"
fi

step '/trace endpoint emits full identity round-trip during a /lookup'
# Background a /trace subscriber for a few seconds, kick a happy-path /lookup,
# then check that the subscriber captured every event in the round-trip:
#   request.received → jwt_svid.issued → sm.authn_jwt.ok →
#   sm.secret_fetched.ok → carrier.lookup.ok
#
# This is the canonical signal that the identity chain is wired correctly
# end-to-end. Carrier emits these via the in-memory trace bus only, NOT via
# log.Printf — kubectl logs would not see them.
trace_out=$(kubectl -n $ns exec portal-stub -- sh -c '
  ( curl -sN --max-time 6 '"$carrier_url"'/trace > /tmp/trace.out 2>/dev/null & )
  sleep 1
  curl -sf --max-time 6 '"$carrier_url"'/lookup/SHP-2049-884 >/dev/null 2>&1 || true
  sleep 3
  cat /tmp/trace.out 2>/dev/null
' 2>/dev/null || echo '')
for evt in 'jwt_svid.issued' 'sm.authn_jwt.ok' 'sm.secret_fetched.ok' 'carrier.lookup.ok'; do
  if echo "$trace_out" | grep -q "\"type\":\"$evt\""; then
    ok "saw $evt"
  else
    err "missing $evt in /trace stream"
  fi
done

step 'unit tests still pass'
if ( cd apps/carrier && go test ./... >/dev/null 2>&1 ); then
  ok 'go test ./...'
else
  err 'unit tests failed (run `cd apps/carrier && go test -v ./...` for details)'
fi

echo
if (( fail == 0 )); then
  echo 'M2 smoketest PASS.'
  exit 0
else
  echo "M2 smoketest FAIL ($fail check(s) failed)."
  exit 1
fi
