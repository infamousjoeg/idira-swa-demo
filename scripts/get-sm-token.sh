#!/usr/bin/env bash
# get-sm-token.sh — Service User → Identity JWT → SM operator token.
# stdout is exactly the value to assign to CONJUR_AUTHN_TOKEN (already base64).
# Run via `summon -p conceal_summon --yaml '...' -- ./scripts/get-sm-token.sh`.
set -euo pipefail

: "${PANW_SM_TENANT:?set in .envrc}"
: "${CLIENT_ID:?inject via summon -p conceal_summon}"
: "${CLIENT_SECRET:?inject via summon -p conceal_summon}"

# Step 1 — Discover Identity URL. The `<subdomain>.id.cyberark.cloud` pattern
# is wrong; the real Identity URL uses a tenant ID (e.g. ack4386). Platform
# Discovery returns the per-tenant value.
identity_url=$(curl -fsSL --max-time 10 \
  "https://platform-discovery.cyberark.cloud/api/v2/services/subdomain/${PANW_SM_TENANT}" \
  | jq -er '.identity_administration.api')

# Step 2 — Mint Service User Identity JWT. The endpoint is /Oauth2/Token/<app_id>
# (camelCase). `__idaptive_cybr_user_oidc` is the cross-tenant default Service
# User OAuth client; verified present on `infamous`. Auth is HTTP Basic.
identity_jwt=$(curl -fsSL --max-time 10 -X POST \
  "${identity_url}/Oauth2/Token/__idaptive_cybr_user_oidc" \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "scope=api" \
  | jq -er .access_token)

# Step 3 — Exchange at SM for the operator token (already base64-encoded
# thanks to Accept-Encoding header — TF provider consumes it verbatim).
curl -fsSL --max-time 10 -X POST \
  "https://${PANW_SM_TENANT}.secretsmgr.cyberark.cloud/api/authn-oidc/cyberark/conjur/authenticate" \
  -H 'Accept-Encoding: base64' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "id_token=${identity_jwt}"
