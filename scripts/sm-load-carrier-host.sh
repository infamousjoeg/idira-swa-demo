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

# Build the policy YAML. NOTE: standard Conjur policy YAML's `!jwt`
# restriction tag is rejected by SM SaaS's policy validator (HTTP 422
# "Unrecognized data type '!jwt'" — verified 2026-05-27). The annotation
# key `authn-jwt/secureWorkloadAccess/...` is server-reserved and also
# rejected. Resolution: load a bare !host. The authenticator's
# identity_path scoping (in 30-jwt-authn.tf) plus SM's auto-membership
# of every host under that branch into the
# `conjur/authn-jwt/secureWorkloadAccess/apps` consumer group provides
# the binding — only this host with this SPIFFE ID, authenticating via
# this authenticator, can read variables granted to it.
if [ "$action" = "up" ]; then
  yaml=$(cat <<YAML
- !host
  id: ${spiffe_id}
  annotations:
    description: Idira SWA demo — carrier service (M2)
    spiffe_id: ${spiffe_id}
YAML
  )
else
  yaml=$(cat <<YAML
- !delete
  record: !host ${spiffe_id}
YAML
  )
fi

url="${CONJUR_APPLIANCE_URL}/api/policies/conjur/policy/${branch_encoded}"

# PATCH is idempotent: re-loading the same host is a no-op; deleting an
# already-deleted host returns 201 with empty `created_roles`. Either way,
# exit non-zero only on transport error (curl -f drops body on >=400).
http=$(curl -sL -o /tmp/sm-load-carrier-host.out -w '%{http_code}' \
  -X PATCH \
  -H "Authorization: Token token=\"${tok}\"" \
  -H 'Content-Type: application/x-yaml' \
  --data-binary "$yaml" \
  "$url")

if [ "$http" != "201" ] && [ "$http" != "200" ]; then
  echo "sm-load-carrier-host.sh $action: HTTP $http" >&2
  cat /tmp/sm-load-carrier-host.out >&2
  exit 1
fi

echo "sm-load-carrier-host.sh $action: HTTP $http (ok)"
