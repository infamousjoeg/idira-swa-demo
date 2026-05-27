# 10-spiffe.tf — SPIFFE hierarchy on the SaaS tenant.
# Creation order is enforced by attribute references:
#   trust_domain → server_group → node_group.
#
# All attribute names below were verified against the bundled provider's
# schema (see SCHEMA.md). The plan's draft used `node_attestor`,
# `trust_domain`, `server_group`, and a top-level `workload_id_template` —
# none of which exist in the provider. Discovered names:
#   - `node_attestation` (not `node_attestor`)
#   - `trust_domain_name`  (not `trust_domain`)
#   - `server_group_name`  (not `server_group`)
#   - `k8s_psat.clusters = { <name> = {...} }`  — a MAP keyed by cluster
#     name, not a flat `cluster = "..."` attribute
#   - `workload_type` is REQUIRED on swa_node_group (plan omitted it)
#   - `workload_configuration.spiffe_id_template` (not top-level
#     `workload_id_template`)

resource "swa_trust_domain" "idira" {
  name = var.trust_domain
  # jwt {} and x509 {} blocks left unset → provider defaults
  # (signature_algorithm, TTLs, etc.)
}

resource "swa_server_group" "kind_sg" {
  name              = var.server_group
  trust_domain_name = swa_trust_domain.idira.name
  # Explicit empty description: provider bug rev v0.1.0-0d54f57b-758 returns
  # `description = ""` post-apply even when HCL omits it, causing Terraform
  # to error on "inconsistent result after apply" (was null, now ""). Setting
  # the field explicitly to a string keeps plan and apply state aligned.
  description = "kind-laptop server group (k8s_psat) — M1"

  node_attestation = {
    k8s_psat = {
      clusters = {
        # Map key is the cluster name. Agent's
        # nodeAttestor.k8s_psat.cluster value MUST equal this exact string.
        (var.kind_cluster) = {
          # The audience the agent's projected SA token must declare.
          # Matches swa-agent chart's `nodeAttestor.k8s_psat.tokenPath`
          # projected-volume audience configuration.
          audience = ["swa-server"]

          # Lock attestation down to the swa-agent SA only.
          # NOTE: the provider schema docstring says "namespace/name format"
          # (slash), but the swa-server in v1.0.4 actually enforces
          # "namespace:name" (colon). Verified empirically: with slash the
          # agent log shows
          #   PermissionDenied: "swa-system:swa-agent" is not an allowed
          #   service account
          # — i.e. the server prints the SA in colon form and matches the
          # allow-list literally.
          service_account_allow_list = [
            "${var.swa_namespace}:${var.swa_agent_sa}",
          ]
        }
      }
    }
  }
}

resource "swa_node_group" "kind_ng" {
  name              = var.node_group
  trust_domain_name = swa_trust_domain.idira.name
  server_group_name = swa_server_group.kind_sg.name
  # See swa_server_group: same "was null, now \"\"" provider quirk.
  description = "kind-laptop node group — M1"

  # REQUIRED — schema enum is "unix" | "kubernetes". Drives the default
  # SPIFFE ID template and variable-prefix conventions.
  workload_type = "kubernetes"

  # workload_configuration left unset → provider applies the default
  # kubernetes SPIFFE ID template. If post-apply diagnostics show the
  # default template doesn't include the node_group segment we expect,
  # set spiffe_id_template explicitly here.
}
