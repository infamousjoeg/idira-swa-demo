# 40-policy.tf — Conjur policy: branches that scope the carrier identity +
# the carrier api-key variable. The carrier HOST itself is NOT managed here
# — see the lifecycle comment below.
#
# Provider: cyberark/conjur ~> 0.8.4. The provider's model is
# resource-per-entity (NOT a single YAML policy load), so the M2 plan's
# `conjur_policy { policy = <<-YAML ... }` shape is translated below into
# discrete resources. See SCHEMA.md.
#
# Topology managed here:
#
#   data/swa-demo                                       <-- branch
#     data/swa-demo/carrier                             <-- branch
#                                                           (variable + permission live in 50-secret.tf)
#
# The carrier identity branch (`data/swa/trust-domains/idira.demo/workloads`)
# is NOT managed here — `swa_trust_domain.idira` (in 10-spiffe.tf) auto-
# creates the full SWA tree (trust-domains, <td>, <td>/workloads) as a
# side-effect of trust-domain registration. Trying to also manage the
# `workloads` branch via `conjur_policy_branch` returns 409 Conflict on
# create. Verified empirically 2026-05-27 by comparing created_at
# timestamps: the trust domain and the workloads branch share the same
# millisecond.
#
# WHY NO `conjur_host` RESOURCE: cyberark/conjur v0.8.4 has a broken Read
# implementation for hosts whose name contains `:` (SPIFFE IDs do). Every
# `terraform plan` refresh 404s on the carrier host even when it exists in
# SM, drops it from state, and the subsequent apply 409s on recreate.
# `terraform import conjur_host.X ...` also rejects: "Resource Import Not
# Implemented." Empirically verified 2026-05-27. Workaround: load the
# carrier host via PATCH policy YAML from a script invoked by a
# null_resource in 50-secret.tf. The resulting host is then referenced by
# the conjur_permission grant via literal-string lookup (kind/branch/name).
#
# PROVIDER QUIRK (v0.8.4): conjur_policy_branch.ValidateConfig rejects
# `branch` values that are not pure string literals at validate time, even when
# the value is a variable interpolation with a default (`"${var.trust_domain}"`)
# or a reference to another `conjur_policy_branch.X.full_id`. Both forms trigger
# "branch branch cannot be empty." So every branch attribute below must be a
# LITERAL string — no `var.X`, no resource references. Trust domain `idira.demo`
# matches `var.trust_domain` default; if the default ever changes, these
# literals must change in lockstep (callout in spec).

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

# ---- Carrier host: NOT managed by Terraform ----
#
# The carrier host (name = "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier",
# parent branch = "data/swa/trust-domains/idira.demo/workloads") is loaded
# into SM by scripts/sm-load-carrier-host.sh, invoked from a null_resource
# in 50-secret.tf. See the WHY NO `conjur_host` RESOURCE callout in the
# file header for the root cause and reproduction.
#
# Trust chain (unchanged by the script-vs-TF split):
#   JWT-SVID → authenticator (iss/aud/sig + JWKS) → host lookup by sub
#     → conjur_permission.carrier_read_api_key (in 50-secret.tf) grants
#       host read+execute on the api-key variable.
#
# The host's YAML body (in the script) binds it to authenticate ONLY via
# the `secureWorkloadAccess` JWT authenticator (`restrictions: [!jwt
# authenticator: secureWorkloadAccess]`) — equivalent in effect to the
# `authn_descriptors[].type=jwt` we would have set on conjur_host.
