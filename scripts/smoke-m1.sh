#!/usr/bin/env bash
# smoke-m1.sh — M1 acceptance check (spec §14.1).
# Hard fails on any deviation. Exit 0 = PASS, exit non-zero = FAIL.
#
# Deviations from the plan's draft script (preserved here so the validator
# can diff against the plan):
#
#   1. Server-auth signal is `msg=ServerCaBundleUploaded subsystem=controlplane`,
#      NOT `successfully authenticat` (the bundled server never logs that
#      string). A successful upload to /api/swa/v1/servergroups/ca-bundles
#      requires a valid SM JWT auth response, so its presence is proof.
#
#   2. Agent attestation success is observed via the SERVER's
#      `msg=SVIDIssued ... subject=spiffe://<td>/swa-agent/...` event, NOT
#      via any agent-side log line. In v1.0.4 the agent itself emits only
#      "Starting/Started" lines and broadcast notices; the canonical
#      attestation-completed signal lives on the server.
#
#   3. SaaS REST sanity check uses an INLINE base64 token mint, not
#      `eval "$(make tf-token)"`. The TF provider needs raw-JSON
#      CONJUR_AUTHN_TOKEN (no `Accept-Encoding: base64`); the /api/swa REST
#      endpoints in contrast want the base64-encoded form, returning 401
#      "malformed authorization token" otherwise. Two formats, two mints.
#      See header of scripts/get-sm-token.sh.
#
#   4. Verified empirically: trust-domain GET path is
#      `/api/swa/trust-domains/<name>` (no `/v1/` prefix), even though
#      server-group endpoints DO use `/api/swa/v1/...`. The SM REST surface
#      is not uniformly versioned.

set -euo pipefail

: "${PANW_SM_TENANT:?set in .envrc}"
sm_base="https://${PANW_SM_TENANT}.secretsmgr.cyberark.cloud"
ns=swa-system
fail=0

step() { printf '\n== %s ==\n' "$*"; }
ok()   { printf '  [ok]   %s\n' "$*"; }
err()  { printf '  [FAIL] %s\n' "$*"; fail=$((fail+1)); }

# ---- Cluster-side checks (no tenant credentials needed) ---------------------

step 'swa-server deployment ready'
ready=$(kubectl -n "$ns" get deploy swa-server -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0)
[[ "$ready" == "1" ]] && ok "readyReplicas=1" || err "readyReplicas=$ready"

step 'swa-agent daemonset desired==ready'
desired=$(kubectl -n "$ns" get ds swa-agent -o jsonpath='{.status.desiredNumberScheduled}' 2>/dev/null || echo 0)
ready=$(  kubectl -n "$ns" get ds swa-agent -o jsonpath='{.status.numberReady}' 2>/dev/null || echo 0)
[[ "$desired" == "$ready" && "$ready" != "0" ]] \
  && ok "desired=$desired ready=$ready" \
  || err "desired=$desired ready=$ready"

step 'swa-server authenticated to SaaS control plane'
# `ServerCaBundleUploaded ... subsystem=controlplane` is emitted ONLY after
# a successful POST to /api/swa/v1/servergroups/ca-bundles. The post is
# rejected with 401 if the SM JWT authenticator declines the projected SA
# token, so this line's presence is proof of successful authn.
if kubectl -n "$ns" logs deploy/swa-server --tail=400 \
   | grep -qE 'msg=ServerCaBundleUploaded .*subsystem=controlplane'; then
  ok 'server uploaded CA bundle to control plane'
else
  err 'no ServerCaBundleUploaded in last 400 server log lines'
fi

step 'swa-agent attested and was issued an SVID'
# Look on the SERVER side, not the agent side — see deviation #2 above.
if kubectl -n "$ns" logs deploy/swa-server --tail=400 \
   | grep -qE 'msg=SVIDIssued .*subject=spiffe://[^ ]+/swa-agent/'; then
  ok 'agent SVID issued by server'
else
  err 'no agent SVID issued in last 400 server log lines'
fi

step 'workload key type is RSA (not EC) in agent configmap'
cm=$(kubectl -n "$ns" get cm -o name | grep -i agent | head -1)
data=$(kubectl -n "$ns" get "$cm" -o jsonpath='{.data}' 2>/dev/null || echo '')
if grep -qi 'RSA' <<<"$data" && ! grep -qi 'ECP' <<<"$data"; then
  ok 'RSA present, no ECP'
else
  err 'expected RSA, found: '"$(grep -oE '[A-Z]+[0-9]+' <<<"$data" | sort -u | xargs)"
fi

# ---- Tenant-side check (mints its own base64 token — see deviation #3) ------

step 'SaaS tenant has trust_domain=idira.demo (control-plane round-trip)'
sm_b64_token=$(summon -p conceal_summon --yaml '
CLIENT_ID: !var infamousdev/claudecode/client_id
CLIENT_SECRET: !var infamousdev/claudecode/client_secret
' -- bash -c '
  set -euo pipefail
  identity_url=$(curl -fsSL --max-time 10 \
    "https://platform-discovery.cyberark.cloud/api/v2/services/subdomain/${PANW_SM_TENANT}" \
    | jq -er ".identity_administration.api")
  identity_jwt=$(curl -fsSL --max-time 10 -X POST \
    "${identity_url}/Oauth2/Token/__idaptive_cybr_user_oidc" \
    -u "${CLIENT_ID}:${CLIENT_SECRET}" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "grant_type=client_credentials" \
    --data-urlencode "scope=api" \
    | jq -er .access_token)
  curl -fsSL --max-time 10 -X POST \
    "https://${PANW_SM_TENANT}.secretsmgr.cyberark.cloud/api/authn-oidc/cyberark/conjur/authenticate" \
    -H "Accept-Encoding: base64" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "id_token=${identity_jwt}"
')

td=$(curl -fsSL --max-time 10 \
  "$sm_base/api/swa/trust-domains/idira.demo" \
  -H "Authorization: Token token=\"$sm_b64_token\"" \
  -H 'Accept: application/x.secretsmgr.v2+json' \
  | jq -er .name 2>/dev/null || true)

[[ "$td" == "idira.demo" ]] && ok "tenant has trust_domain=$td" || err "got td='$td'"

# ---- Summary ----------------------------------------------------------------

echo
if (( fail == 0 )); then
  echo 'M1 smoketest PASS.'
  exit 0
else
  echo "M1 smoketest FAIL ($fail check(s) failed)."
  exit 1
fi
