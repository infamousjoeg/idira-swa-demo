# 30-jwt-authn.tf — Configure the Conjur authn-jwt authenticator
# `secureWorkloadAccess` (spec §6.3) on the SM SaaS tenant.
#
# Provider: cyberark/conjur ~> 0.8.4 (NOT the bundled cyberark/swa provider,
# which has no policy/authenticator/secret resources — see SCHEMA.md and
# spec §7.1 AMENDED 2026-05-27).
#
# Identity model:
#   - issuer:             <sm_url>/api/swa/trust-domains/<td>
#   - jwks_uri:           <sm_url>/api/swa/trust-domains/<td>/.well-known/jwks
#   - audience:           "conjur"  (matches the audience the carrier requests
#                                   from the SPIFFE Workload API; see
#                                   apps/carrier/handler.go)
#   - token_app_property: "sub"     (the JWT `sub` claim holds the SPIFFE ID)
#   - identity_path:      data/swa/trust-domains/<td>/workloads
#                                   (hosts authenticating via this JWT must
#                                    live under this branch — see 40-policy.tf)

resource "conjur_authenticator" "swa" {
  name    = "secureWorkloadAccess"
  type    = "jwt"
  enabled = true

  data = {
    audience = "conjur"
    issuer   = "${var.sm_url}/api/swa/trust-domains/${var.trust_domain}"
    jwks_uri = "${var.sm_url}/api/swa/trust-domains/${var.trust_domain}/.well-known/jwks"

    identity = {
      identity_path      = "data/swa/trust-domains/${var.trust_domain}/workloads"
      token_app_property = "sub"
    }
  }
}
