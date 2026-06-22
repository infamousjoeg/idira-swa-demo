#!/usr/bin/env bash
# get-sm-token-b64.sh -- Service User -> Identity JWT -> SM operator token (base64 form).
# stdout is the base64-encoded token suitable for /api/swa REST calls via
# `Authorization: Token token="<stdout>"`. NOT compatible with the cyberark/swa
# Terraform provider; use scripts/get-sm-token.sh for that (raw JSON form).
#
# Why two scripts: the SM /authn-oidc endpoint returns the same Conjur access
# token in either JSON or base64 form depending on `Accept-Encoding`. The TF
# provider (conjur-api-go) expects raw JSON in CONJUR_AUTHN_TOKEN; the REST
# surface at /api/swa expects the base64 form in the Authorization header.
# Mixing them returns 401 "malformed authorization token". See header of
# scripts/get-sm-token.sh and the comment block in scripts/smoke-m1.sh.
#
# Run via `summon -p conceal_summon --yaml '...' -- ./scripts/get-sm-token-b64.sh`.
set -euo pipefail

: "${PANW_SM_TENANT:?set in .envrc}"
: "${CLIENT_ID:?inject via summon -p conceal_summon}"
: "${CLIENT_SECRET:?inject via summon -p conceal_summon}"

identity_url=$(curl -fsSL --max-time 10 \
  "https://platform-discovery.cyberark.cloud/api/v2/services/subdomain/${PANW_SM_TENANT}" \
  | jq -er '.identity_administration.api')

identity_jwt=$(curl -fsSL --max-time 10 -X POST \
  "${identity_url}/Oauth2/Token/__idaptive_cybr_user_oidc" \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "scope=api" \
  | jq -er .access_token)

curl -fsSL --max-time 10 -X POST \
  "https://${PANW_SM_TENANT}.secretsmgr.cyberark.cloud/api/authn-oidc/cyberark/conjur/authenticate" \
  -H 'Accept-Encoding: base64' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "id_token=${identity_jwt}"
