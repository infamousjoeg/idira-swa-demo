# The bundled v1.0.0 provider exports the server registration ID as `authn_id`
# (renamed from `login_url` in v1.0.4). This is the value the server chart
# consumes as controlPlane.auth.authnID (via SWA_AUTHN_ID env substitution in
# platform/helm/swa-server.values.yaml.tmpl).
output "authn_id" {
  description = "swa_server.kind.authn_id -- SM authentication ID for this SWA server registration. Substituted into the helm chart as controlPlane.auth.authnID."
  value       = swa_server.kind.authn_id
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

# --- M2 outputs (carrier identity + secret it can read) ---

output "carrier_host_id" {
  description = "SPIFFE ID of the carrier workload -- matches conjur_host.carrier.name and the JWT-SVID sub claim."
  value       = "spiffe://${var.trust_domain}/${var.node_group}/ns/swa-demo/sa/carrier"
}

output "carrier_secret_id" {
  description = "Conjur variable path the carrier reads via the SM REST API (form: 'swa-demo/carrier/api-key', sans 'data/' prefix). trimprefix handles the v0.8.4 provider's '/data/...' normalization."
  value       = trimprefix("${conjur_secret.carrier_api_key.branch}/${conjur_secret.carrier_api_key.name}", "/data/")
}
