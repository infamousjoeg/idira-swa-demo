# 50-secret.tf — The actual Conjur variable the carrier reads + inline
# permission scoping that read/execute to exactly the carrier SPIFFE host.
#
# Provider: cyberark/conjur ~> 0.8.4. Resource is `conjur_secret` (NOT
# `conjur_variable` — the SCHEMA.md catalog discovered on 2026-05-27 confirms
# `conjur_secret` is the variable-CRUD resource). The plan example's
# `conjur_secret { variable = "..." }` shape is translated below into the
# actual schema: `branch` (parent path) + `name` (leaf segment).
#
# Value: random_password rotates on node_group change so each `make up` after
# a node group rename gets a fresh secret (no point in stable secrets in a
# demo — and rotation pressure-tests the carrier's read path).
#
# Permissions: inline `permissions = [...]` block grants read+execute to the
# carrier host (declared in 40-policy.tf) and no one else. This is the spec
# §13.4 criterion "secret scoping is least privilege" — only that one host
# can fetch this one variable; no consumer groups, no wildcards.
#
# PROVIDER QUIRK reminder: same literal-string-only rule applies to
# conjur_secret.branch (verified empirically — variable interpolation in
# branch trips ValidateConfig). subject.id below is also a literal for the
# same reason (defense-in-depth — the quirk affects multiple attrs on this
# provider line).

resource "random_password" "carrier_api_key" {
  length  = 32
  special = false

  # Rotate when the carrier's node group is renamed (which would also change
  # the carrier's SPIFFE ID and force a re-bind in 40-policy.tf). Demo-grade
  # rotation policy — production would key off something more deliberate.
  keepers = {
    rotate_on = var.node_group
  }
}

resource "conjur_secret" "carrier_api_key" {
  # Literal — same provider quirk as conjur_policy_branch.branch /
  # conjur_host.branch (see 40-policy.tf header). Must match
  # conjur_policy_branch.swa_demo_carrier.full_id ("data/swa-demo/carrier")
  # in lockstep with any change to that branch path.
  #
  # SECOND v0.8.4 QUIRK: the provider normalizes the branch on read by
  # prepending a leading slash ("/data/swa-demo/carrier") but accepts both
  # forms on create. If the HCL value lacks the slash, Terraform complains
  # post-apply with "Provider produced inconsistent result: was 'data/...'
  # but now '/data/...'" and taints the resource. Workaround: send the
  # slash-prefixed form here so HCL matches what the provider returns from
  # state refresh. Verified empirically 2026-05-27.
  branch = "/data/swa-demo/carrier"
  name   = "api-key"
  value  = random_password.carrier_api_key.result

  # NOTE on permissions: the inline `permissions = [...]` block on
  # conjur_secret is a no-op in provider v0.8.4 — verified by reading
  # back the variable's permissions via /api/resources REST after apply
  # (empty list, even though TF state holds the requested grant). The
  # actual permission grant is therefore split out into a separate
  # `conjur_permission` resource below.

  depends_on = [
    conjur_policy_branch.swa_demo_carrier,
  ]
}

# Load the carrier host out-of-band via PATCH policy YAML (the cyberark/conjur
# v0.8.4 conjur_host resource has a broken Read that drops the host from state
# on every refresh — see 40-policy.tf header). The script is idempotent: re-
# loading the same host body returns 201 with no-op. Triggers ensure the
# resource re-runs if the SPIFFE ID or the authenticator changes.
resource "null_resource" "carrier_host" {
  triggers = {
    spiffe_id        = "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier"
    authenticator    = conjur_authenticator.swa.name
    workloads_branch = conjur_policy_branch.workloads.full_id
  }

  # Create / refresh the host. Env (CONJUR_APPLIANCE_URL + CONJUR_AUTHN_TOKEN)
  # is inherited from the surrounding `make tf-apply-app` summon-wrapped shell.
  provisioner "local-exec" {
    when    = create
    command = "${path.module}/../../scripts/sm-load-carrier-host.sh up"
  }

  # Destroy provisioners can't reference variables/resources (TF 0.13+
  # restriction). The script reads CONJUR_APPLIANCE_URL + CONJUR_AUTHN_TOKEN
  # from its env; `make down` ensures both are set when `terraform destroy`
  # runs.
  provisioner "local-exec" {
    when    = destroy
    command = "${path.module}/../../scripts/sm-load-carrier-host.sh down"
  }

  depends_on = [
    conjur_authenticator.swa,
    conjur_policy_branch.workloads,
  ]
}

# Grant the carrier host read+execute on the api-key variable. This is the
# only host that can fetch this variable, satisfying spec §13.4 "secret
# scoping is least privilege".
resource "conjur_permission" "carrier_read_api_key" {
  privileges = ["read", "execute"]

  resource = {
    branch = "/data/swa-demo/carrier" # matches conjur_secret.branch normalization
    kind   = "variable"
    name   = "api-key"
  }

  role = {
    branch = "data/swa/trust-domains/idira.demo/workloads" # carrier host's parent branch
    kind   = "host"
    name   = "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier"
  }

  # PROVIDER QUIRK (v0.8.4): on refresh, the provider reads `privileges`
  # back as an empty list even though the SM tenant has both `read` and
  # `execute` granted (verified via direct REST GET on the variable's
  # permissions list). This spurious diff forces update-in-place on every
  # apply. ignore_changes prevents the redundant write; the privileges
  # list is still authoritative on initial create. To actually change
  # privileges later, remove this lifecycle block, apply once, then add
  # it back.
  lifecycle {
    ignore_changes = [privileges]
  }

  depends_on = [
    conjur_secret.carrier_api_key,
    null_resource.carrier_host,
  ]
}
