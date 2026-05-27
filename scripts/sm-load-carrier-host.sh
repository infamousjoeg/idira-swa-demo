#!/usr/bin/env bash
# sm-load-carrier-host.sh — manage the carrier SPIFFE host on the SM tenant.
#
# Why a script instead of `conjur_host` resource: cyberark/conjur provider
# v0.8.4 has a broken Read implementation for hosts whose name contains
# colons (SPIFFE IDs do). Every `terraform plan/apply` refresh 404s on the
# host even when it exists, drops the resource from state, and then 409
# Conflict's on recreate. This script loads the host via PATCH policy YAML
# (which IS idempotent for create — repeated loads of the same host return
# 201 with no-op result) so the carrier identity survives multiple
# `terraform apply` cycles. See platform/terraform/40-policy.tf for the
# full context and 50-secret.tf for the conjur_permission that grants the
# host read/execute on the api-key variable.
#
# Usage:
#   sm-load-carrier-host.sh up    — create or refresh the host record
#   sm-load-carrier-host.sh down  — delete the host record
#
# Env (REQUIRED — set by Terraform local-exec or Makefile target):
#   CONJUR_APPLIANCE_URL   SM SaaS base URL (https://<sub>.secretsmgr.cyberark.cloud)
#   CONJUR_AUTHN_TOKEN     Raw Conjur JSON access token from get-sm-token.sh
#                          (this script base64-encodes it for the REST header)
#
# The host is loaded into branch:
#   data/swa/trust-domains/idira.demo/workloads
#
# IMPORTANT: trust domain "idira.demo" and node group "kind-ng" are
# hardcoded here in lockstep with the literals in 40-policy.tf (the
# provider quirk that forces literal-only `branch` values applies equally
# to YAML policy loads — there's no var.X substitution into the URL).
set -euo pipefail

action="${1:-}"
case "$action" in
  up|down) ;;
  *) echo "usage: $0 up|down" >&2; exit 64 ;;
esac

: "${CONJUR_APPLIANCE_URL:?must be set (https://<sub>.secretsmgr.cyberark.cloud)}"
: "${CONJUR_AUTHN_TOKEN:?must be set (raw Conjur JSON access token)}"

# Base64-encode the JSON token for the REST `Authorization: Token token="…"`
# header (conjur-api-go does this internally; raw scripts must do it manually).
tok=$(printf '%s' "$CONJUR_AUTHN_TOKEN" | base64 | tr -d '\n')

# URL-encode the workloads branch path for the PATCH endpoint.
branch_path="data/swa/trust-domains/idira.demo/workloads"
branch_encoded=$(python3 -c \
  "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" \
  "$branch_path")

spiffe_id="spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier"

# SM SaaS quirks affecting this script:
#   - Standard Conjur `restrictions: [!jwt authenticator: X]` is rejected
#     with HTTP 422 "Unrecognized data type '!jwt'". The supported mechanism
#     for binding a JWT `sub` claim to a host is the
#     `authn-jwt/<service-id>/sub` annotation, NOT a restriction block.
#     See swa-docs/pages/cjr-authn-jwt-swa.md lines 137-153.
#   - Without the `authn-jwt/secureWorkloadAccess/sub` annotation, SM cannot
#     map the JWT-SVID's `sub` claim back to the host record and the
#     authenticate endpoint returns 401 with an empty body — diagnostically
#     useless. Verified 2026-05-27 by exhaustively confirming iss/aud/sub
#     are correct, signature/JWKS kid match, host is in apps group, and the
#     401 still occurred until the annotation was added.
#   - SM does NOT auto-add hosts under the authenticator's identity_path
#     to the `conjur/authn-jwt/secureWorkloadAccess/apps` consumer group
#     (verified 2026-05-27 via GET /resources/.../group/.../apps — the
#     group's `members` field stays empty until explicitly granted).
#     Without that membership SM returns 403 from the authenticate endpoint
#     even though the JWT-SVID is signature-valid and iss/aud/sub-correct.
#
# Resolution: TWO PATCHes on `up` (and the inverse on `down`):
#   1) Load a `!host` (with the authn-jwt sub annotation) into the
#      workloads branch.
#   2) Load a `!grant` into the authenticator's own policy branch binding
#      the carrier host into the apps consumer group.
# Both are idempotent: re-applying yields 201 with no-op result, and
# `!delete` of an absent record is also 201 with empty `deleted_roles`.

authn_branch="conjur/authn-jwt/secureWorkloadAccess"
authn_branch_encoded=$(python3 -c \
  "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" \
  "$authn_branch")

# Fully-qualified host id, as it appears in SM (relative to the workloads
# branch). Used for the grant's !host reference from a different policy
# branch.
host_fqid="${branch_path}/${spiffe_id}"

if [ "$action" = "up" ]; then
  host_yaml=$(cat <<YAML
- !host
  id: ${spiffe_id}
  annotations:
    description: Idira SWA demo — carrier service (M2)
    spiffe_id: ${spiffe_id}
    authn-jwt/secureWorkloadAccess/sub: ${spiffe_id}
YAML
  )
  grant_yaml=$(cat <<YAML
- !grant
  role: !group apps
  member: !host /${host_fqid}
YAML
  )
else
  # On down: drop the grant first (so the policy is clean even if the host
  # delete is skipped for any reason), then drop the host. Order does not
  # affect correctness of the next 'up'.
  host_yaml=$(cat <<YAML
- !delete
  record: !host ${spiffe_id}
YAML
  )
  grant_yaml=$(cat <<YAML
- !revoke
  role: !group apps
  member: !host /${host_fqid}
YAML
  )
fi

patch_policy() {
  local label="$1" url="$2" body="$3"
  local out="/tmp/sm-load-carrier-host.${label}.out"
  local code
  code=$(curl -sL -o "$out" -w '%{http_code}' \
    -X PATCH \
    -H "Authorization: Token token=\"${tok}\"" \
    -H 'Content-Type: application/x-yaml' \
    --data-binary "$body" \
    "$url")
  if [ "$code" != "201" ] && [ "$code" != "200" ]; then
    echo "sm-load-carrier-host.sh $action [$label]: HTTP $code" >&2
    cat "$out" >&2
    return 1
  fi
  echo "sm-load-carrier-host.sh $action [$label]: HTTP $code (ok)"
}

host_url="${CONJUR_APPLIANCE_URL}/api/policies/conjur/policy/${branch_encoded}"
grant_url="${CONJUR_APPLIANCE_URL}/api/policies/conjur/policy/${authn_branch_encoded}"

# Order on 'up': host then grant (the grant references the host).
# Order on 'down': grant then host (revoke before the role disappears, even
# though Conjur tolerates revoking via a deleted member).
if [ "$action" = "up" ]; then
  patch_policy host  "$host_url"  "$host_yaml"
  patch_policy grant "$grant_url" "$grant_yaml"
else
  patch_policy grant "$grant_url" "$grant_yaml"
  patch_policy host  "$host_url"  "$host_yaml"
fi
