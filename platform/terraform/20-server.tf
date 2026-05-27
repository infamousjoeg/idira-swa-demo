# 20-server.tf — register the kind cluster as an SWA server using inline JWKS.
#
# Why inline JWKS:
#   The SaaS tenant cannot reach a laptop's kind API server, so the JWT
#   authenticator config must embed JWKS content via `auth.public_keys`
#   (see SCHEMA.md). The bundled provider's auth schema requires the
#   wrapper `{"type":"jwks","value":{"keys":[...]}}` — raw JWKS is not
#   accepted. `scripts/kind-oidc.sh` returns the issuer + raw JWKS; the
#   wrapping happens here, in HCL, so the script stays kind-agnostic.
#
# Deviations from the plan's draft (also catalogued in SCHEMA.md):
#   - swa_server has NO `trust_domain` field (server is scoped only via
#     server_group).
#   - The field is `server_group_id` (not `server_group`) — pass the
#     computed `.id` from swa_server_group.
#   - The block is named `auth` (not `authentication`), and its inner
#     fields are flat (no nested `data = {...}` indirection).
#   - `auth.type` is the literal string "JWT" (uppercase per the schema's
#     example), `auth.subject` is REQUIRED to identify the workload.

data "external" "kind_oidc" {
  program = ["bash", "${path.module}/../../scripts/kind-oidc.sh"]
}

resource "swa_server" "kind" {
  name            = var.server_name
  server_group_id = swa_server_group.kind_sg.id

  auth = {
    type = "JWT"

    # The kind API server's OIDC issuer URL, e.g.
    # "https://kubernetes.default.svc.cluster.local".
    issuer = data.external.kind_oidc.result.issuer

    # JWT claim values for the swa-server pod's projected SA token:
    #   - audience = "conjur"  (matches controlPlane.auth.audience in
    #     swa-server chart's values.yaml — the projected volume mounts a
    #     token with this audience for SM authentication)
    #   - subject  = "system:serviceaccount:<ns>:<sa>"  (canonical
    #     Kubernetes SA subject for the swa-server pod)
    audience = "conjur"
    subject  = "system:serviceaccount:${var.swa_namespace}:${var.swa_server_sa}"

    # Inline JWKS. The provider expects the wrapped form
    # {"type":"jwks","value":<raw-jwks>}; kind-oidc.sh returns the raw
    # JWKS, so we jsondecode → wrap → jsonencode here.
    public_keys = jsonencode({
      type  = "jwks"
      value = jsondecode(data.external.kind_oidc.result.public_keys)
    })

    # Deliberately no `jwks_uri` — tenant cannot reach the laptop.
    # Deliberately no `ca_cert` — only used with jwks_uri.
    # Deliberately no `identity {}` — workload→identity mapping is an M2
    # concern (not part of server registration).
  }
}
