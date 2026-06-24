# 60-laptop.tf -- M8.1 laptop swa-agent identity.
#
# Adds a second server group + node group under the existing trust domain
# (idira.demo) so a swa-agent running on Joe's MacBook can attest via
# x509pop and fetch JWT-SVIDs against the in-cluster swa-server (reached
# via `kubectl port-forward` on 127.0.0.1:18443; see
# scripts/portforward-swa-server.sh).
#
# Resources created here, in this dependency order:
#
#   tls_private_key.macos_dev_x509pop
#   tls_self_signed_cert.macos_dev_x509pop  (CN = joe-macbook-ng)
#       |
#       v
#   swa_server_group.macos_dev_sg           (node_attestation.x509pop.ca_certificates)
#       |
#       v
#   swa_node_group.joe_macbook_ng           (workload_type = "unix")
#       |
#       v
#   null_resource.laptop_host               (PATCH the SPIFFE host into SM
#                                            via scripts/sm-load-laptop-host.sh)
#
# Verified attribute names (against `terraform providers schema -json` for
# the bundled cyberark/swa v0.1.0-c2081762-821 provider):
#   - swa_server_group.node_attestation.x509pop.ca_certificates  -- STRING
#     (PEM bundle), the only attribute in the x509pop block. There is NO
#     per-cert allow-list (`certificates`, `allowed_certs`, `fingerprints`
#     do NOT exist). We register a single self-signed cert as the CA bundle
#     -- since the cert is its own CA (is_ca_certificate = true) and nobody
#     else holds the private key, only that one cert chains back to itself,
#     giving effective allow-list semantics for a single agent.
#   - swa_node_group.workload_type  -- STRING, valid: "unix" | "kubernetes".
#     macOS path uses "unix" (drives the default unix workload-attestor
#     selectors: uid, gid, path, etc.).
#   - swa_node_group.server_group_name + trust_domain_name  -- both REQUIRED
#     STRING; reference the parent resources by .name (NOT .id).
#
# Verified attribute names (hashicorp/tls v4.x):
#   - tls_self_signed_cert.subject is a NESTED BLOCK (`subject { ... }`),
#     not an attribute assignment (`subject = { ... }`). Block has
#     common_name, country, organization, etc.
#   - tls_self_signed_cert.allowed_uses is a LIST attribute; values are
#     SPIRE/x509 string identifiers (`client_auth`, `digital_signature`,
#     `key_encipherment`, ...). For x509pop client attestation we need
#     `client_auth` (extended-key-usage) plus `digital_signature` so the
#     TLS handshake can sign with the leaf key.
#   - tls_self_signed_cert.is_ca_certificate makes the cert a self-CA so
#     the server's x509 verifier (which expects a chain to a CA) accepts
#     the agent presenting the same cert as both root and leaf.
#   - tls_private_key.algorithm + ecdsa_curve mint an ECDSA P-256 key
#     (smaller, faster than RSA 2048; matches SPIRE conventions).
#
# Naming convention: the x509pop attestor requires the cert Subject CN to
# equal the node group's "expected agent name" -- spec section 4. The SWA
# node-group resource name is `joe_macbook_ng` (snake_case for HCL), but
# the wire identifier used in the SPIFFE ID (and therefore the x509 CN)
# is `joe-macbook-ng` (kebab-case). The mapping is intentional and
# matches the carrier's `kind_ng` -> `kind-ng` precedent in 10-spiffe.tf.

resource "tls_private_key" "macos_dev_x509pop" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_self_signed_cert" "macos_dev_x509pop" {
  private_key_pem = tls_private_key.macos_dev_x509pop.private_key_pem

  # CN MUST equal the wire name the swa-server uses to identify the agent.
  # Kebab-case `joe-macbook-ng` (NOT snake_case `joe_macbook_ng`) -- the
  # node group's HCL identifier and its on-the-wire name follow the same
  # kind_ng -> kind-ng convention as M1.
  subject {
    common_name  = "joe-macbook-ng"
    organization = "Idira SWA demo (M8)"
  }

  # 1y validity. Rotation is `make down-m8 && make up-m8`; no rotation flow
  # in M8 (documented in spec section 5.2).
  validity_period_hours = 8760
  early_renewal_hours   = 720 # plan flags renewal needed in last 30d

  # Self-CA so the swa-server's x509 verifier accepts the agent presenting
  # the same cert as both leaf and root. The cert PEM is also registered as
  # the server group's x509pop ca_certificates bundle below.
  is_ca_certificate = true

  # client_auth: extended key usage required for TLS client cert presentation.
  # digital_signature + key_encipherment: needed for the TLS handshake key
  # exchange. cert_signing: required because is_ca_certificate=true makes
  # this a CA-style cert.
  allowed_uses = [
    "client_auth",
    "digital_signature",
    "key_encipherment",
    "cert_signing",
  ]
}

# Server group: macOS dev agents attest via x509pop.
resource "swa_server_group" "macos_dev_sg" {
  name              = "macos_dev_sg"
  trust_domain_name = swa_trust_domain.idira.name

  # Same provider quirk as `swa_server_group.kind_sg` (10-spiffe.tf): the
  # provider returns `description = ""` post-apply even when HCL omits it,
  # which trips "inconsistent result after apply". Set explicitly.
  description = "macOS dev laptops (x509pop) -- M8"

  node_attestation = {
    x509pop = {
      # PEM bundle the swa-server uses to verify the presented cert chains
      # to a known CA. Single self-signed cert -- effectively a one-cert
      # allow-list per the file header.
      ca_certificates = tls_self_signed_cert.macos_dev_x509pop.cert_pem
    }
  }
}

# Node group: workload_type=unix drives the unix workload-attestor selectors
# (uid, gid, binary path). The actual SPIFFE ID for Joe's claude-code
# workload is registered explicitly via the host record loaded by
# null_resource.laptop_host below (same pattern as the carrier).
resource "swa_node_group" "joe_macbook_ng" {
  name              = "joe_macbook_ng"
  trust_domain_name = swa_trust_domain.idira.name
  server_group_name = swa_server_group.macos_dev_sg.name

  description = "Joe's MacBook (unix workload attestor) -- M8"

  # REQUIRED -- schema enum is "unix" | "kubernetes".
  workload_type = "unix"

  # workload_configuration left unset -> provider applies the default unix
  # SPIFFE template. Workload identity for claude-code is provided by the
  # explicit host record below; the default template is only the fallback
  # when no host matches.
}

# Load the laptop SPIFFE host out-of-band via PATCH policy YAML (same
# provider quirk as the carrier in 50-secret.tf -- conjur_host.Read is
# broken for IDs containing colons). The script is idempotent: reloading
# the same host body returns 201 with no-op.
resource "null_resource" "laptop_host" {
  triggers = {
    spiffe_id     = "spiffe://idira.demo/joe-macbook-ng/users/joe.garcia/claude-code"
    node_group    = swa_node_group.joe_macbook_ng.name
    authenticator = "secureWorkloadAccess"
    trust_domain  = swa_trust_domain.idira.name
  }

  # Create / refresh the host. Env (CONJUR_APPLIANCE_URL + CONJUR_AUTHN_TOKEN)
  # is inherited from the surrounding `make up-m8` summon-wrapped shell.
  provisioner "local-exec" {
    when    = create
    command = "${path.module}/../../scripts/sm-load-laptop-host.sh up"
  }

  # Destroy provisioners cannot reference vars/resources (TF 0.13+ rule).
  # The script reads CONJUR_APPLIANCE_URL + CONJUR_AUTHN_TOKEN from env;
  # `make down-m8` ensures both are set when `terraform destroy` runs.
  provisioner "local-exec" {
    when    = destroy
    command = "${path.module}/../../scripts/sm-load-laptop-host.sh down"
  }

  depends_on = [
    swa_node_group.joe_macbook_ng,
    swa_trust_domain.idira, # workloads branch auto-created here
  ]
}

# Outputs consumed by scripts/install-laptop-agent.sh (Task 1.7).
output "macos_dev_x509pop_cert_pem" {
  description = "PEM-encoded self-signed cert for the macOS swa-agent (CN=joe-macbook-ng). Written to disk by install-laptop-agent.sh; also registered as the server group's x509pop ca_certificates bundle."
  value       = tls_self_signed_cert.macos_dev_x509pop.cert_pem
  sensitive   = false # cert is public material
}

output "macos_dev_x509pop_key_pem" {
  description = "PEM-encoded private key for the macOS swa-agent's x509pop cert. Written to ~/Library/Application Support/swa-agent/agent.key with mode 0600 by install-laptop-agent.sh."
  value       = tls_private_key.macos_dev_x509pop.private_key_pem
  sensitive   = true
}

output "macos_dev_sg_name" {
  description = "Name of the macOS dev server group (for diagnostic curls against the SM REST API)."
  value       = swa_server_group.macos_dev_sg.name
}

output "joe_macbook_ng_name" {
  description = "Name of Joe's MacBook node group (matches the kebab-case CN of the x509pop cert)."
  value       = swa_node_group.joe_macbook_ng.name
}

output "laptop_host_spiffe_id" {
  description = "SPIFFE ID registered for Joe's Claude Code workload. Becomes the JWT-SVID sub claim and is matched by the Anthropic federation rule's subject_prefix in M8.2."
  value       = "spiffe://${var.trust_domain}/joe-macbook-ng/users/joe.garcia/claude-code"
}
