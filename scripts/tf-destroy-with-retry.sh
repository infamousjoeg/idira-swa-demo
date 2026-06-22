#!/usr/bin/env bash
# tf-destroy-with-retry.sh -- destroy platform/terraform state with token-expiry
# tolerance. Shared by `make down` and `make clean-orphans`.
#
# Caller responsibility:
#   * cwd is the repo root (so ./scripts/get-sm-token.sh resolves)
#   * env: PANW_SM_TENANT, PANW_SM_URL, CONCEAL_NAMESPACE (for context, unused here)
#   * env: CLIENT_ID, CLIENT_SECRET injected via:
#       summon -p conceal_summon --yaml '...' -- ./scripts/tf-destroy-with-retry.sh
#
# Behavior: up to 3 destroy attempts, each with a freshly-minted SM token; stop
# as soon as `terraform state list` is empty. The retry exists because SM tokens
# expire ~8min and a full destroy can outrun that on a slow tenant; the tenant
# also intermittently returns 409 "Concurrent policy load" mid-batch. Both are
# transient. See the `down` recipe comments in the root Makefile.
set -uo pipefail

: "${PANW_SM_TENANT:?set in .envrc}"
: "${CLIENT_ID:?inject via summon -p conceal_summon}"
: "${CLIENT_SECRET:?inject via summon -p conceal_summon}"
# Compute PANW_SM_URL if caller didn't pre-supply it (Makefile does; CLI doesn't).
: "${PANW_SM_URL:=https://${PANW_SM_TENANT}.secretsmgr.cyberark.cloud}"

TF="terraform -chdir=platform/terraform"

for attempt in 1 2 3; do
  echo "==> tf destroy attempt $attempt/3"
  tok=$(./scripts/get-sm-token.sh)
  CONJUR_APPLIANCE_URL="$PANW_SM_URL" CONJUR_AUTHN_TOKEN="$tok" \
    $TF destroy -auto-approve -refresh=false -var "sm_url=$PANW_SM_URL" || true
  remaining=$($TF state list 2>/dev/null | wc -l | tr -d ' ')
  echo "==> tf state remaining: $remaining"
  if [ "$remaining" = "0" ]; then
    exit 0
  fi
done

exit 1
