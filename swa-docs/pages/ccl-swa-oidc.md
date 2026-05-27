---
source: https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-swa-oidc.htm
title: Configure OIDC issuer values for SWA integrations
---

# Configure OIDC issuer values for SWA integrations

This topic describes the OpenID Connect (OIDC) issuer and discovery values that Secure Workload Access (SWA) uses for external platform federation.

Use this topic to review issuer and discovery values before you configure a supported external platform integration.

> **Note:**
>
> For current regional availability and support scope, see [Secrets Manager support and scope](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-support.htm).

## Use the required OIDC values

Use the following OIDC values when you configure a supported external platform integration.

- Issuer URL: Identifies the Secure Workload Access (SWA) trust domain for the integration.
- Discovery document: Available at `<issuer-url>/.well-known/openid-configuration`.

You can retrieve the discovery URL and JWKS URI from the trust domain object.

To retrieve OIDC discovery values for a trust domain:

1. Authenticate to Secrets Manager - SaaS and get an access token.

   For details, see [Authenticate user](https://docs.cyberark.com/early-release/swa/en/content/developer/conjur_api_authenticate_user.htm).
2. Set environment variables for your tenant and trust domain.

   ```
   export TOKEN="<access-token>"
   export TENANT_SUBDOMAIN="<subdomain>"
   export TRUST_DOMAIN_NAME="<trust-domain-name>"
   ```
3. Send a GET request to the trust domain endpoint.

   ```
   curl -sS -X GET "https://${TENANT_SUBDOMAIN}.secretsmgr.cyberark.cloud/api/swa/trust-domains/${TRUST_DOMAIN_NAME}" \
     -H "Authorization: Token token=\"${TOKEN}\"" \
     -H "Accept: application/x.secretsmgr.v2+json" \
     -H "Content-Type: application/json"
   ```
4. In the response, find the discovery URLs under `jwt.discovery_endpoints`.

   - OIDC discovery document: `jwt.discovery_endpoints.oidc_discovery_url`
   - JWKS URI: `jwt.discovery_endpoints.jwks_uri`
5. Confirm your response includes `oidc_discovery_url` and `jwks_uri` values.

   ```
   {
     "name": "<trust-domain-name>",
     "jwt": {
       "discovery_endpoints": {
         "jwks_uri": "https://<subdomain>.secretsmgr.cyberark.cloud/api/swa/trust-domains/<trust-domain-name>/.well-known/jwks",
         "oidc_discovery_url": "https://<subdomain>.secretsmgr.cyberark.cloud/api/swa/trust-domains/<trust-domain-name>/.well-known/openid-configuration"
       },
       "signature_algorithm": "RS512",
       "signing_key_type": "RSA_4096"
     }
   }
   ```

   This example shows the default RSA pairing (`RS512` with `RSA_4096`). Elliptic-curve signing is optional on the trust domain. For allowed values, see [Configure JWT requirements for SWA integrations](ccl-swa-jwt.md).

Use these OIDC values in the provider-specific integration steps for the supported external platform.

## Next steps

Use these links to continue your Secure Workload Access (SWA) integration workflow.

Review JWT support requirements in [Configure JWT requirements for SWA integrations](ccl-swa-jwt.md).

To continue with platform setup, see [Integrate external platforms](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-cloud-platforms-lp.htm) and follow the provider-specific procedure for your external platform.
