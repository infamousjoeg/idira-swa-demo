#!/usr/bin/env bash
# kind-oidc.sh — output kind cluster's OIDC discovery + JWKS as a flat JSON
# object, for consumption by Terraform's `external` data source.
#
# Output shape:
#   { "issuer": "https://kubernetes.default.svc.cluster.local",
#     "public_keys": "<raw JWKS json as string>" }
set -euo pipefail

issuer=$(kubectl get --raw /.well-known/openid-configuration | jq -er .issuer)
jwks=$(kubectl get --raw /openid/v1/jwks)

# `external` requires string-valued fields. We embed the JWKS as a single
# JSON string; consumers parse it as needed.
jq -n --arg issuer "$issuer" --arg public_keys "$jwks" \
  '{issuer: $issuer, public_keys: $public_keys}'
