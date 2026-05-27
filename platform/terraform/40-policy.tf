# 40-policy.tf — Conjur policy scoping the carrier's SPIFFE ID to one secret.
#
# Provider: cyberark/conjur ~> 0.8.4. The provider's model is
# resource-per-entity (NOT a single YAML policy load), so the M2 plan's
# `conjur_policy { policy = <<-YAML ... }` shape is translated below into
# discrete resources. See SCHEMA.md.
#
# Topology created here:
#
#   data/swa/trust-domains/idira.demo/workloads         <-- branch (parent of host)
#     host  spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier
#       authn_descriptor: jwt service_id=secureWorkloadAccess, claim sub=<spiffe-id>
#
#   data/swa-demo                                       <-- branch
#     data/swa-demo/carrier                             <-- branch
#       (the actual variable lives here in 50-secret.tf with inline read/execute
#        permission granted to the carrier host below)
#
# PROVIDER QUIRK (v0.8.4): conjur_policy_branch.ValidateConfig rejects
# `branch` values that are not pure string literals at validate time, even when
# the value is a variable interpolation with a default (`"${var.trust_domain}"`)
# or a reference to another `conjur_policy_branch.X.full_id`. Both forms trigger
# "branch branch cannot be empty." So every branch attribute below must be a
# LITERAL string — no `var.X`, no resource references. Trust domain `idira.demo`
# matches `var.trust_domain` default; if the default ever changes, these
# literals must change in lockstep (callout in spec).

# ---- Workloads policy branch (identity_path target of the authenticator) ----
resource "conjur_policy_branch" "workloads" {
  branch = "data/swa/trust-domains/idira.demo"
  name   = "workloads"
}

# ---- Variable-scope branches (carrier secret lives at swa-demo/carrier) ----
resource "conjur_policy_branch" "swa_demo" {
  branch = "data"
  name   = "swa-demo"
}

resource "conjur_policy_branch" "swa_demo_carrier" {
  # Literal (NOT conjur_policy_branch.swa_demo.full_id — see provider quirk
  # comment at top). depends_on enforces creation order.
  branch = "data/swa-demo"
  name   = "carrier"

  depends_on = [conjur_policy_branch.swa_demo]
}

# ---- Carrier host: declares the carrier's SPIFFE ID as a Conjur host and
# binds it to the secureWorkloadAccess JWT authenticator ----
#
# When a JWT-SVID arrives with sub=<carrier_spiffe_id>, the authenticator
# (see 30-jwt-authn.tf) looks up the host at <identity_path>/<sub>. The
# authn_descriptor's `claims` map adds an additional constraint: the JWT
# MUST present these exact claim values to authenticate as this host —
# defense-in-depth against an attacker who somehow registers a host with
# the same name but a different SPIFFE ID.
resource "conjur_host" "carrier" {
  # Literal — same provider quirk applies to conjur_host.branch.
  branch = "data/swa/trust-domains/idira.demo/workloads"
  name   = "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier"

  annotations = {
    description = "Idira SWA demo — carrier service (M2)"
    spiffe_id   = "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier"
  }

  authn_descriptors = [
    {
      type       = "jwt"
      service_id = "secureWorkloadAccess"
      data = {
        claims = {
          sub = "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier"
        }
      }
    },
  ]

  depends_on = [
    conjur_authenticator.swa,
    conjur_policy_branch.workloads,
  ]
}
