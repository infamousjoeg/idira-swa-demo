#!/usr/bin/env bash
# sm-load-laptop-host.sh -- manage the laptop SPIFFE host on the SM tenant.
#
# Sibling of scripts/sm-load-carrier-host.sh. Same provider quirk
# workaround: the cyberark/conjur v0.8.4 provider's conjur_host.Read is
# broken for IDs containing colons (SPIFFE IDs do), so the laptop host is
# loaded via PATCH policy YAML instead of an HCL resource. See the carrier
# script header (and 40-policy.tf) for the full reproduction.
#
# Usage:
#   sm-load-laptop-host.sh up    -- create or refresh the host + grant
#   sm-load-laptop-host.sh down  -- delete the host + grant
#
# Env (REQUIRED, set by Terraform local-exec or `make up-m8`):
#   CONJUR_APPLIANCE_URL  SM SaaS base URL (https://<sub>.secretsmgr.cyberark.cloud)
#   CONJUR_AUTHN_TOKEN    Raw Conjur JSON access token from get-sm-token.sh
#                         (this script base64-encodes it for the REST header)
#
# Host loaded into branch:
#   data/swa/trust-domains/idira.demo/workloads
#
# IMPORTANT: trust domain "idira.demo" and node group "joe-macbook-ng" are
# hardcoded here in lockstep with 60-laptop.tf (the provider quirk that
# forces literal-only `branch` values applies equally to YAML policy loads;
# there is no var.X substitution into the URL).
#
# Refs: spec sections 5.3, 11.1. Plan task 1.3.

set -euo pipefail

action="${1:-}"
case "$action" in
  up|down) ;;
  *) echo "usage: $0 up|down" >&2; exit 64 ;;
esac

: "${CONJUR_APPLIANCE_URL:?must be set (https://<sub>.secretsmgr.cyberark.cloud)}"
: "${CONJUR_AUTHN_TOKEN:?must be set (raw Conjur JSON access token)}"

# Base64-encode the JSON token for the REST `Authorization: Token token="..."`
# header (conjur-api-go does this internally; raw scripts must do it manually).
tok=$(printf '%s' "$CONJUR_AUTHN_TOKEN" | base64 | tr -d '\n')

# URL-encode the workloads branch path for the PATCH endpoint.
branch_path="data/swa/trust-domains/idira.demo/workloads"
branch_encoded=$(python3 -c \
  "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" \
  "$branch_path")

# SPIFFE ID for Joe's Claude Code workload. Anchored under the
# joe-macbook-ng node group (kebab-case wire name, matching the x509pop
# cert CN minted by 60-laptop.tf). Anthropic's federation rule
# subject_prefix (M8.2) matches this prefix via trailing-asterisk wildcard.
spiffe_id="spiffe://idira.demo/joe-macbook-ng/users/joe.garcia/claude-code"

# Same SM SaaS quirks as the carrier:
#   * Standard Conjur `restrictions: [!jwt authenticator: X]` is rejected
#     with HTTP 422 "Unrecognized data type '!jwt'". The supported mechanism
#     for binding the JWT `sub` claim is the
#     `authn-jwt/<service-id>/sub` annotation, NOT a restriction block.
#   * Without the `authn-jwt/secureWorkloadAccess/sub` annotation, SM
#     cannot map the JWT-SVID `sub` claim back to the host record and the
#     authenticate endpoint returns 401 with an empty body.
#   * SM does NOT auto-add hosts under the authenticator's identity_path
#     to the `conjur/authn-jwt/secureWorkloadAccess/apps` consumer group;
#     without that membership SM returns 403 from the authenticate
#     endpoint even though the JWT-SVID is signature-valid.
#
# Resolution: TWO PATCHes on `up` (and the inverse on `down`):
#   1) Load a `!host` (with the authn-jwt sub annotation) into the
#      workloads branch.
#   2) Load a `!grant` into the authenticator's own policy branch binding
#      the laptop host into the apps consumer group.

authn_branch="conjur/authn-jwt/secureWorkloadAccess"
authn_branch_encoded=$(python3 -c \
  "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" \
  "$authn_branch")

# Fully-qualified host id (relative to the workloads branch). Used for the
# grant's !host reference from a different policy branch.
host_fqid="${branch_path}/${spiffe_id}"

if [ "$action" = "up" ]; then
  host_yaml=$(cat <<YAML
- !host
  id: ${spiffe_id}
  annotations:
    description: "Joe's MacBook -- Claude Code (M8)"
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
  local out="/tmp/sm-load-laptop-host.${label}.out"
  local code
  code=$(curl -sL -o "$out" -w '%{http_code}' \
    -X PATCH \
    -H "Authorization: Token token=\"${tok}\"" \
    -H 'Content-Type: application/x-yaml' \
    --data-binary "$body" \
    "$url")
  if [ "$code" != "201" ] && [ "$code" != "200" ]; then
    echo "sm-load-laptop-host.sh $action [$label]: HTTP $code" >&2
    cat "$out" >&2
    return 1
  fi
  echo "sm-load-laptop-host.sh $action [$label]: HTTP $code (ok)"
}

host_url="${CONJUR_APPLIANCE_URL}/api/policies/conjur/policy/${branch_encoded}"
grant_url="${CONJUR_APPLIANCE_URL}/api/policies/conjur/policy/${authn_branch_encoded}"

# Order on 'up': host then grant (the grant references the host).
# Order on 'down': grant then host (revoke before the role disappears,
# even though Conjur tolerates revoking via a deleted member).
if [ "$action" = "up" ]; then
  patch_policy host  "$host_url"  "$host_yaml"
  patch_policy grant "$grant_url" "$grant_yaml"
else
  patch_policy grant "$grant_url" "$grant_yaml"
  patch_policy host  "$host_url"  "$host_yaml"
fi
