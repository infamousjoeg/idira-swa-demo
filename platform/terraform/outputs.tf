# Renamed in the bundled schema: the plan called this `authn_id`, but the
# provider exports it as `login_url` (see SCHEMA.md). This is the value the
# server chart consumes as controlPlane.auth.loginURL (via SWA_AUTHN_ID env
# substitution in platform/helm/swa-server.values.yaml.tmpl).
output "login_url" {
  description = "swa_server.kind.login_url — Conjur login URL for this SWA server registration. Substituted into the helm chart as controlPlane.auth.loginURL."
  value       = swa_server.kind.login_url
}

# The IDs are useful for debugging via the SM REST API.
output "trust_domain_id" {
  description = "Computed ID of the trust domain (for SM REST diagnostics)."
  value       = swa_trust_domain.idira.id
}

output "server_group_id" {
  description = "Computed ID of the server group (also referenced as swa_server.server_group_id)."
  value       = swa_server_group.kind_sg.id
}

output "node_group_id" {
  description = "Computed ID of the node group."
  value       = swa_node_group.kind_ng.id
}

output "server_id" {
  description = "Computed ID of the SWA server registration."
  value       = swa_server.kind.id
}
