# Idira SWA Demo — M1 Platform Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `make up` (M1 subset — through `install-agent`) that yields a healthy `swa-server` and `swa-agent` on a fresh kind cluster, with the SPIFFE hierarchy created on the `infamous` Secrets Manager – SaaS tenant and the SWA Server registered using **inline JWKS** (never `jwks_uri`, since the tenant can't reach a laptop).

**Architecture:** Bash + Makefile orchestration around a `cyberark/swa` Terraform module (two-apply pattern; M1 covers apply #1) and two Helm charts from the gitignored `swa-release-1.0.4/` bundle. No application code yet. Tenant auth is two-hop OAuth (Identity → SM `authn-oidc`) producing a base64 `CONJUR_AUTHN_TOKEN` consumed by the TF provider.

**Tech Stack:** kind (k8s 1.34), Helm v3, Terraform ≥1.6, `cyberark/swa` provider `0.1.0-0d54f57b-758`, bash, curl, jq, kubectl, docker.

**Spec under implementation:** `docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md`. Sections referenced inline as §X.Y.

**Prerequisites the builder verifies in Task 0:**
- macOS Apple Silicon (bundle's `*-arm64v8.tar` image tarballs are required for runtime).
- `docker`, `kind`, `kubectl`, `helm`, `terraform`, `jq`, `curl`, `summon`, `conceal` on PATH.
- `swa-release-1.0.4/` directory present at repo root (gitignored vendor drop).
- `.envrc` exists with `PANW_SM_TENANT` (the SM SaaS subdomain — `infamous`). **No secrets in `.envrc`** — credentials are read from macOS Keychain via Conceal at `infamousdev/claudecode/client_id` and `infamousdev/claudecode/client_secret`, surfaced via `summon -p conceal_summon` (see spec §6.1).

---

## File structure (M1 creates)

```
.envrc.example                          # documents required env (Task 1)
.gitignore                              # appended (Task 1)
README.md                               # demo entry point — skeleton (Task 1)
Makefile                                # built up across M1
scripts/
  doctor.sh                             # prereq checker (Task 2)
  get-sm-token.sh                       # two-hop OAuth (Task 3) — spec §6.1
  kind-oidc.sh                          # kind JWKS/issuer extractor for TF (Task 4)
  smoke-m1.sh                           # M1 smoketest (Task 19)
platform/
  helm/
    swa-server.values.yaml.tmpl         # source (Task 14)
    swa-agent.values.yaml.tmpl          # source (Task 16)
  terraform/
    main.tf                             # provider block (Task 7)
    variables.tf                        # inputs (Task 7)
    outputs.tf                          # authn_id (Task 7, populated in Task 9)
    10-spiffe.tf                        # trust domain, server group, node group (Task 8)
    20-server.tf                        # server with inline JWKS (Task 9)
    SCHEMA.md                           # captured provider schema excerpt (Task 6) — gitignored
```

**Out of M1's scope (M2/M3 own them):** `apps/`, `platform/terraform/30-*.tf`/`40-*.tf`/`50-*.tf`, `scripts/smoke-ui.sh`, anything Go.

---

## Methodology notes

- **TDD-flavored, not strict TDD.** M1 is infrastructure. The "test" for most tasks is `terraform validate`, `helm lint`, `helm template | grep`, or `kubectl get … -o jsonpath`. Each task ends with a verification command whose **expected output is shown**. If it doesn't match, stop and debug — don't proceed.
- **Commit after every task** unless the task explicitly says otherwise. The §13 builder-validator pattern relies on small commits so the validator can read each one.
- **Tenant calls are real.** `terraform apply` in this plan creates real objects on the live `infamous` tenant. Each `apply` task is matched by a `destroy` step inside `make down` (Task 20) so the validator can run `make up && make down` and end with `terraform state list` empty.
- **Helm values files are templated.** The `.tmpl` is checked in; the rendered `.yaml` is gitignored because it contains tenant URLs and the `authn_id` from TF output. Templates are expanded via `envsubst`.

---

## Task 0: Verify workspace and prerequisites

**Files:** none. Read-only.

- [ ] **Step 1: Confirm Apple Silicon and bundle present**

Run:
```bash
uname -m && ls swa-release-1.0.4/container-images/*arm64v8.tar
```
Expected: prints `arm64` then lists `swa-server-…-arm64v8.tar` and `swa-agent-…-arm64v8.tar`. If either is missing or `uname -m` is not `arm64`, stop and surface to user.

- [ ] **Step 2: Confirm `.envrc` has the non-secret env**

Run:
```bash
test -f .envrc && grep -cE '^export PANW_SM_TENANT=' .envrc
```
Expected: `1`. If `0` or `.envrc` missing, surface to user: "M1 plan requires `PANW_SM_TENANT` in `.envrc`. Cannot proceed."

- [ ] **Step 2b: Confirm Conceal-stored credentials are present**

Run:
```bash
conceal get infamousdev/claudecode/client_id >/dev/null  && echo '[ok] client_id'  || echo '[MISSING] client_id'
conceal get infamousdev/claudecode/client_secret >/dev/null && echo '[ok] client_secret' || echo '[MISSING] client_secret'
```
Expected: both `[ok]`. If `[MISSING]`, surface to user: "M1 plan requires `infamousdev/claudecode/client_id` and `client_secret` in Conceal. Run `conceal set infamousdev/claudecode/client_id <login>` etc. Cannot proceed."

- [ ] **Step 3: No commit (read-only).**

---

## Task 1: Repo scaffolding

**Files:**
- Create: `.envrc.example`
- Modify: `.gitignore`
- Create: `README.md`
- Create: `Makefile`

- [ ] **Step 1: Create `.envrc.example`** (no secrets — Conceal owns those; see spec §6.1)

```bash
# .envrc.example — copy to .envrc and fill in. .envrc is gitignored.
# Only non-secret env lives here. Secrets are read from macOS Keychain via
# Conceal at infamousdev/claudecode/client_id|secret, injected into
# tenant-touching commands via `summon -p conceal_summon`.

# Secrets Manager SaaS tenant subdomain (subdomain only, without `.secretsmgr.cyberark.cloud`):
export PANW_SM_TENANT=infamous

# Optional — kind cluster name (default "swa"):
# export KIND_CLUSTER=swa
```

- [ ] **Step 2: Append to `.gitignore`** (file currently has one entry — `swa-release-1.0.4/`)

```
# M1 additions
.envrc
platform/terraform/.terraform/
platform/terraform/.terraform.lock.hcl
platform/terraform/terraform.tfstate
platform/terraform/terraform.tfstate.backup
platform/terraform/.terraform.tfstate.lock.info
platform/terraform/SCHEMA.md
platform/helm/*.values.yaml
```

Rationale per line:
- `.envrc` — secrets.
- `.terraform/`, `.terraform.lock.hcl` — provider cache, host-specific.
- `*.tfstate*` and lock — local state files; in this demo we don't share state across machines.
- `SCHEMA.md` — captured per-machine in Task 6; not stable across provider versions.
- `*.values.yaml` — rendered from `.tmpl` per-machine, contains tenant URLs.

- [ ] **Step 3: Create `README.md`**

```markdown
# Idira SWA Demo

A Mac-laptop demo of Palo Alto Networks' **Idira Secure Workload Access (SWA)**:
a real workload fetches a real secret from CyberArk Secrets Manager – SaaS using
a SPIFFE JWT-SVID minted in-cluster — no static credentials in the workload, no
agent token on disk.

## Prerequisites

- macOS Apple Silicon
- `docker`, `kind`, `kubectl`, `helm`, `terraform`, `jq`, `curl` on PATH
- `swa-release-1.0.4/` bundle in this directory (gitignored vendor drop)
- A Secrets Manager – SaaS tenant with an OAuth client. Copy `.envrc.example`
  to `.envrc` and fill in `IDIRA_CLIENT_ID` / `IDIRA_CLIENT_SECRET`.

## Quick start

```bash
cp .envrc.example .envrc && vim .envrc      # fill in client_id / client_secret
make doctor                                  # verify prerequisites
make up                                      # full deploy (~3 min)
make portforward                             # serve portal on http://localhost:8080
make down                                    # tear everything down
```

## Token TTL

Identity OAuth tokens are ≤15 min. SM access tokens are ~8 min. Every Make
target that touches the tenant re-fetches a fresh token via
`scripts/get-sm-token.sh`. For manual `terraform` runs, source
`eval "$(make tf-token)"` first.

## Design

See `docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md`.
```

- [ ] **Step 4: Create `Makefile` skeleton** (later tasks add targets; this skeleton has `help`, `doctor`, `tf-token`, and a placeholder `down`)

```make
SHELL := bash
.SHELLFLAGS := -euo pipefail -c

# Required env (sourced from .envrc):
#   PANW_SM_TENANT       (SM SaaS subdomain, e.g. "infamous")
# Optional:
#   KIND_CLUSTER         (default "swa")
#
# Secrets are NOT in env. Credentials live in macOS Keychain via Conceal and
# are injected into tenant-touching commands via $(SUMMON) (see below).
KIND_CLUSTER ?= swa
PANW_SM_URL  := https://$(PANW_SM_TENANT).secretsmgr.cyberark.cloud
TF           := terraform -chdir=platform/terraform

# SUMMON wraps a command, injecting CLIENT_ID + CLIENT_SECRET into its env from
# Conceal-backed macOS Keychain. Provider flag is `conceal_summon` (not
# `conceal` — see vault memory cyberark-tenant.md 2026-05-27). Multiline yaml
# is intentional: Make passes it as one arg to summon.
define SUMMON_YAML
CLIENT_ID: !var infamousdev/claudecode/client_id
CLIENT_SECRET: !var infamousdev/claudecode/client_secret
endef
export SUMMON_YAML
SUMMON = summon -p conceal_summon --yaml "$$SUMMON_YAML"

.DEFAULT_GOAL := help
.PHONY: help doctor tf-token down _check-env

help: ## Show this help
	@awk 'BEGIN{FS=":.*##"} /^[a-zA-Z_-]+:.*##/{printf "  %-22s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

doctor: ## Verify prerequisites
	@./scripts/doctor.sh

_check-env:
	@: "$${PANW_SM_TENANT:?set in .envrc}"

tf-token: _check-env ## Print env exports to source for manual `terraform` use
	@echo "export CONJUR_APPLIANCE_URL=$(PANW_SM_URL)"
	@printf 'export CONJUR_AUTHN_TOKEN=%s\n' "$$($(SUMMON) -- ./scripts/get-sm-token.sh)"

down: _check-env ## Tear down everything (cluster + tenant TF state). Best-effort.
	-helm -n swa-system uninstall swa-agent swa-server 2>/dev/null
	-kubectl delete ns swa-demo swa-system --wait=false 2>/dev/null
	-kind delete cluster --name $(KIND_CLUSTER)
	-$(SUMMON) -- bash -c 'CONJUR_APPLIANCE_URL=$(PANW_SM_URL) CONJUR_AUTHN_TOKEN=$$(./scripts/get-sm-token.sh) $(TF) destroy -auto-approve' 2>/dev/null || true
```

- [ ] **Step 5: Verify Make help works**

Run: `make help`
Expected (exit 0, four lines — order matches definition order):
```
  help                   Show this help
  doctor                 Verify prerequisites
  tf-token               Print env exports to source for manual `terraform` use
  down                   Tear down everything (cluster + tenant TF state). Best-effort.
```

- [ ] **Step 6: Commit**

```bash
git add .envrc.example .gitignore README.md Makefile
git commit -m "feat(m1): scaffold envrc example, gitignore, readme, makefile skeleton"
```

---

## Task 2: `scripts/doctor.sh`

**Files:**
- Create: `scripts/doctor.sh`

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
# doctor.sh — verify M1 prerequisites. Exits 0 iff every check passes.
set -euo pipefail

fail=0

check_cmd() {
  local cmd=$1 hint=$2
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf '  [MISSING] %-12s — %s\n' "$cmd" "$hint"
    fail=$((fail+1))
  else
    printf '  [ok]      %-12s\n' "$cmd"
  fi
}

check_path() {
  local path=$1 hint=$2
  if [[ ! -e "$path" ]]; then
    printf '  [MISSING] %-30s — %s\n' "$path" "$hint"
    fail=$((fail+1))
  else
    printf '  [ok]      %-30s\n' "$path"
  fi
}

check_arch() {
  local arch
  arch=$(uname -m)
  if [[ "$arch" != "arm64" ]]; then
    printf '  [WRONG]   uname -m == %s — M1 plan targets Apple Silicon (arm64)\n' "$arch"
    fail=$((fail+1))
  else
    printf '  [ok]      apple-silicon (%s)\n' "$arch"
  fi
}

echo 'Tools:'
check_cmd docker     'install Docker Desktop or colima'
check_cmd kind       'brew install kind'
check_cmd kubectl    'brew install kubectl'
check_cmd helm       'brew install helm'
check_cmd terraform  'brew install terraform'
check_cmd jq         'brew install jq'
check_cmd curl       'macOS ships curl; check PATH'
check_cmd envsubst   'brew install gettext && brew link --force gettext'
check_cmd summon     'brew install summon'
check_cmd conceal    'brew install cyberark/tools/conceal'

echo
echo 'Host:'
check_arch

echo
echo 'Bundle:'
check_path 'swa-release-1.0.4'                                          'vendor drop must be in repo root'
check_path 'swa-release-1.0.4/container-images'                         'image tarballs'
check_path 'swa-release-1.0.4/helm/swa-server-0.1.0.tgz'                'server chart'
check_path 'swa-release-1.0.4/helm/swa-agent-0.1.0.tgz'                 'agent chart'
check_path 'swa-release-1.0.4/install-terraform-provider.sh'            'provider installer'

echo
echo 'Non-secret env (from .envrc):'
if [[ -f .envrc ]]; then
  set +u
  # shellcheck disable=SC1091
  source .envrc
  set -u
  if [[ -z "${PANW_SM_TENANT:-}" ]]; then
    printf '  [MISSING] $PANW_SM_TENANT\n'; fail=$((fail+1))
  else
    printf '  [ok]      $PANW_SM_TENANT=%s\n' "$PANW_SM_TENANT"
  fi
else
  printf '  [MISSING] .envrc — copy .envrc.example and fill in PANW_SM_TENANT\n'
  fail=$((fail+1))
fi

echo
echo 'Secrets (macOS Keychain via Conceal):'
for path in 'infamousdev/claudecode/client_id' 'infamousdev/claudecode/client_secret'; do
  if conceal get "$path" >/dev/null 2>&1; then
    printf '  [ok]      conceal:%s\n' "$path"
  else
    printf '  [MISSING] conceal:%s — run `conceal set %s <value>`\n' "$path" "$path"
    fail=$((fail+1))
  fi
done

echo
echo 'Tenant reachability (Platform Discovery):'
if [[ -n "${PANW_SM_TENANT:-}" ]]; then
  if curl -fsSL --max-time 5 \
       "https://platform-discovery.cyberark.cloud/api/v2/services/subdomain/${PANW_SM_TENANT}" \
       | jq -er '.identity_administration.api' >/dev/null 2>&1; then
    printf '  [ok]      platform-discovery resolves Identity URL for %s\n' "$PANW_SM_TENANT"
  else
    printf '  [FAIL]    platform-discovery cannot resolve Identity URL for %s\n' "$PANW_SM_TENANT"
    fail=$((fail+1))
  fi
else
  printf '  [skip]    PANW_SM_TENANT not set — cannot probe discovery\n'
fi

echo
if (( fail == 0 )); then
  echo 'All prerequisites satisfied.'
  exit 0
else
  echo "Doctor found $fail issue(s). Resolve them before continuing M1."
  exit 1
fi
```

- [ ] **Step 2: Make executable and run**

```bash
chmod +x scripts/doctor.sh
make doctor
```

Expected: every line prefixed `[ok]`, final line `All prerequisites satisfied.`, exit 0. If any `[MISSING]`, install the missing tool / fix the env var and re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/doctor.sh
git commit -m "feat(m1): add doctor.sh prereq checker"
```

---

## Task 3: `scripts/get-sm-token.sh` (Service User + Conceal — spec §6.1)

**Files:**
- Create: `scripts/get-sm-token.sh`

The script reads `CLIENT_ID` and `CLIENT_SECRET` from its env (injected by `summon -p conceal_summon` per the SUMMON macro in Task 1's Makefile) and `PANW_SM_TENANT` from `.envrc`. It discovers the Identity URL via Platform Discovery, mints a Service User Identity JWT, and exchanges it at SM for the operator token.

- [ ] **Step 1: Create the script** (lifted from amended spec §6.1)

```bash
#!/usr/bin/env bash
# get-sm-token.sh — Service User → Identity JWT → SM operator token.
# stdout is exactly the value to assign to CONJUR_AUTHN_TOKEN (already base64).
# Run via `summon -p conceal_summon --yaml '...' -- ./scripts/get-sm-token.sh`.
set -euo pipefail

: "${PANW_SM_TENANT:?set in .envrc}"
: "${CLIENT_ID:?inject via summon -p conceal_summon}"
: "${CLIENT_SECRET:?inject via summon -p conceal_summon}"

# Step 1 — Discover Identity URL. The `<subdomain>.id.cyberark.cloud` pattern
# is wrong; the real Identity URL uses a tenant ID (e.g. ack4386). Platform
# Discovery returns the per-tenant value.
identity_url=$(curl -fsSL --max-time 10 \
  "https://platform-discovery.cyberark.cloud/api/v2/services/subdomain/${PANW_SM_TENANT}" \
  | jq -er '.identity_administration.api')

# Step 2 — Mint Service User Identity JWT. The endpoint is /Oauth2/Token/<app_id>
# (camelCase). `__idaptive_cybr_user_oidc` is the cross-tenant default Service
# User OAuth client; verified present on `infamous`. Auth is HTTP Basic.
identity_jwt=$(curl -fsSL --max-time 10 -X POST \
  "${identity_url}/Oauth2/Token/__idaptive_cybr_user_oidc" \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "scope=api" \
  | jq -er .access_token)

# Step 3 — Exchange at SM for the operator token (already base64-encoded
# thanks to Accept-Encoding header — TF provider consumes it verbatim).
curl -fsSL --max-time 10 -X POST \
  "https://${PANW_SM_TENANT}.secretsmgr.cyberark.cloud/api/authn-oidc/cyberark/conjur/authenticate" \
  -H 'Accept-Encoding: base64' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "id_token=${identity_jwt}"
```

- [ ] **Step 2: Make executable and smoke-test against the real tenant**

```bash
chmod +x scripts/get-sm-token.sh
source .envrc
token=$(summon -p conceal_summon --yaml '
CLIENT_ID: !var infamousdev/claudecode/client_id
CLIENT_SECRET: !var infamousdev/claudecode/client_secret
' -- ./scripts/get-sm-token.sh)
echo "token length: ${#token}"
```

Expected: `token length:` followed by a number > 100 (a base64 SM operator token is typically several hundred bytes). Common failure modes:
- `curl: (22) ... 401` on the Identity call → wrong CLIENT_ID/SECRET in Conceal, or the Service User has been disabled. Verify with `conceal get infamousdev/claudecode/client_id`.
- `jq: error: ... .identity_administration.api` empty → Platform Discovery doesn't recognize `$PANW_SM_TENANT`. Verify the subdomain.
- `curl: ... 401` on the SM exchange → the Identity JWT minted but SM rejected it. Most likely SM's authn-oidc/cyberark/conjur isn't configured to trust this Identity tenant. Surface to user.

- [ ] **Step 3: Verify `make tf-token` produces eval-able output**

```bash
eval "$(make tf-token)"
echo "$CONJUR_APPLIANCE_URL"
echo "${CONJUR_AUTHN_TOKEN:0:20}..."
```

Expected: prints `https://infamous.secretsmgr.cyberark.cloud` then the first 20 chars of the base64 token + `...`. (The `make tf-token` target already wraps in `$(SUMMON)`, so it does not need direct summon invocation here.)

- [ ] **Step 4: Commit**

```bash
git add scripts/get-sm-token.sh
git commit -m "feat(m1): add get-sm-token.sh (service user → conceal → sm operator token)"
```

---

## Task 4: `scripts/kind-oidc.sh` (JWKS extractor for TF external data — spec §7.3)

**Files:**
- Create: `scripts/kind-oidc.sh`

Why: the tenant cannot reach a laptop's kind API server, so the SWA Server's PSAT registration must embed kind's JWKS inline (`public_keys`) rather than reference `jwks_uri`. This script returns the kind cluster's `issuer` and raw JWKS JSON in the shape Terraform's `external` data source requires (flat object of string fields).

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
# kind-oidc.sh — output kind cluster's OIDC discovery + JWKS as a flat JSON
# object, for consumption by Terraform's `external` data source.
#
# Output shape:
#   { "issuer": "https://kubernetes.default.svc.cluster.local",
#     "public_keys": "<raw JWKS json as string>" }
set -euo pipefail

issuer=$(kubectl get --raw /.well-known/openid-configuration | jq -er .issuer)
jwks=$(kubectl get --raw /openid/v1/jwks)

# `external` requires string-valued fields. We embed the JWKS as a single
# JSON string; consumers parse it as needed.
jq -n --arg issuer "$issuer" --arg public_keys "$jwks" \
  '{issuer: $issuer, public_keys: $public_keys}'
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/kind-oidc.sh
```

(We cannot smoke-test until kind is up in Task 10. Defer verification.)

- [ ] **Step 3: Commit**

```bash
git add scripts/kind-oidc.sh
git commit -m "feat(m1): add kind-oidc.sh jwks extractor for terraform external data"
```

---

## Task 5: Install the Terraform provider

**Files:**
- Modify: `Makefile` (add `install-tf-provider` target)

The bundle ships `install-terraform-provider.sh` which auto-detects OS/arch and copies the binary into `~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/<version>/<os>_<arch>/`. macOS Gatekeeper may quarantine it.

- [ ] **Step 1: Add Make target** (append before `down`)

```make
.PHONY: install-tf-provider

install-tf-provider: ## Install cyberark/swa terraform provider from the bundle
	cd swa-release-1.0.4 && ./install-terraform-provider.sh
	@# Defang macOS Gatekeeper quarantine if present (see DEPLOY_MACOS.md).
	-xattr -d com.apple.quarantine \
	  ~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/*/darwin_arm64/terraform-provider-swa_* \
	  2>/dev/null || true
```

- [ ] **Step 2: Run it**

```bash
make install-tf-provider
```

Expected: prints the `required_providers { swa = { source = "cyberark/swa", version = "..." } }` block. Verify the install dir exists:

```bash
ls ~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/*/darwin_arm64/
```

Expected: one `terraform-provider-swa_v…` binary.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "feat(m1): add install-tf-provider make target"
```

---

## Task 6: Discover the provider's resource schema (spec §16 OQ #1)

**Files:**
- Create: `platform/terraform/.discovery/main.tf` (throwaway, gitignored as part of `.terraform/` peers — actually under a subdir we'll delete)
- Create: `platform/terraform/SCHEMA.md` (captured excerpt; gitignored)

The bundled provider ships no docs directory (verified — spec §7.4 and §16 OQ #1). The exact `swa_*` resource names in §7 are best-guess until we read them from the binary. This task discovers them.

- [ ] **Step 1: Scratch a discovery module**

```bash
mkdir -p platform/terraform/.discovery
cat > platform/terraform/.discovery/main.tf <<'HCL'
terraform {
  required_providers {
    swa = {
      source = "cyberark/swa"
    }
  }
}
provider "swa" {}
HCL
```

- [ ] **Step 2: Init and dump schema**

```bash
terraform -chdir=platform/terraform/.discovery init -upgrade
terraform -chdir=platform/terraform/.discovery providers schema -json \
  > platform/terraform/.discovery/schema.json
```

Expected: `Terraform has been successfully initialized!`, then `schema.json` is written (several KB).

- [ ] **Step 3: Enumerate resource and data-source names**

```bash
jq -r '
  .provider_schemas
  | to_entries[]
  | .key as $p
  | (.value.resource_schemas // {}) | keys[] | "resource: \(.)"
' platform/terraform/.discovery/schema.json | sort -u > /tmp/swa-resources.txt
jq -r '
  .provider_schemas
  | to_entries[]
  | (.value.data_source_schemas // {}) | keys[] | "data: \(.)"
' platform/terraform/.discovery/schema.json | sort -u >> /tmp/swa-resources.txt
cat /tmp/swa-resources.txt
```

Expected output (one of these forms — exact strings may differ slightly):
```
resource: swa_trust_domain
resource: swa_server_group
resource: swa_node_group
resource: swa_server
resource: swa_variable        # or similar — the SM secret resource
resource: swa_policy          # or similar — the SM policy loader
resource: swa_authn_jwt       # or similar — JWT authenticator (used in M2)
data: swa_trust_domain        # (optional)
```

**If a name in spec §7.1 doesn't match what `schema.json` shows, the actual schema wins.** Update §7.1 references in this plan's later tasks to the discovered names. Note any rename in `SCHEMA.md`.

- [ ] **Step 4: Capture the schema excerpt to `SCHEMA.md`**

```bash
{
  echo "# Bundled cyberark/swa provider — discovered schema"
  echo
  echo "Captured: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Provider version: $(terraform -chdir=platform/terraform/.discovery version | head -2 | tail -1)"
  echo
  echo '## Resource and data-source names'
  echo
  cat /tmp/swa-resources.txt
  echo
  echo '## Resource attribute schemas (excerpt — required + computed only)'
  echo
  for r in $(grep '^resource: ' /tmp/swa-resources.txt | awk '{print $2}'); do
    echo "### $r"
    jq --arg r "$r" -r '
      .provider_schemas
      | to_entries[0].value
      | .resource_schemas[$r].block.attributes
      | to_entries[]
      | "- \(.key) (\(.value.type)) \(if .value.required then "REQUIRED" else "" end)\(if .value.computed then " COMPUTED" else "" end)"
    ' platform/terraform/.discovery/schema.json
    echo
  done
} > platform/terraform/SCHEMA.md
head -50 platform/terraform/SCHEMA.md
```

Expected: `SCHEMA.md` contains the resource list and per-resource attribute table.

- [ ] **Step 5: Clean up the discovery dir**

```bash
rm -rf platform/terraform/.discovery
```

(We keep `SCHEMA.md` as a reference; the discovery module itself is throwaway.)

- [ ] **Step 6: Commit** (SCHEMA.md is gitignored so this commit is empty if nothing else changed — that's expected; skip the commit if `git status --porcelain` is empty)

```bash
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "chore(m1): capture provider schema discovery (schema.md is gitignored)"
fi
```

---

## Task 7: Terraform module skeleton

**Files:**
- Create: `platform/terraform/main.tf`
- Create: `platform/terraform/variables.tf`
- Create: `platform/terraform/outputs.tf`

Resource names below assume the discovery in Task 6 confirmed them as spec §7.1 lists them. If they differ, substitute the discovered names verbatim.

- [ ] **Step 1: `main.tf`**

```hcl
terraform {
  required_version = ">= 1.6"
  required_providers {
    swa = {
      source  = "cyberark/swa"
      # Pin to the bundled version. `install-terraform-provider.sh` records
      # the exact version in its output — paste it here.
      # version = "0.1.0-0d54f57b-758"
    }
  }
}

# Provider authenticates via env vars set by the Makefile:
#   CONJUR_APPLIANCE_URL  = https://<sm-tenant>.secretsmgr.cyberark.cloud
#   CONJUR_AUTHN_TOKEN    = base64 SM access token (from scripts/get-sm-token.sh)
provider "swa" {}
```

- [ ] **Step 2: `variables.tf`**

```hcl
variable "trust_domain" {
  description = "SPIFFE trust domain. Becomes the SVID URI authority."
  type        = string
  default     = "idira.demo"
}

variable "server_group" {
  description = "SWA server group. Scopes a node attestor (k8s_psat for in-cluster install)."
  type        = string
  default     = "kind-sg"
}

variable "node_group" {
  description = "SWA node group. Must match podLabels.swa_nodegroup in the agent values."
  type        = string
  default     = "kind-ng"
}

variable "server_name" {
  description = "SWA server registration name. Used in the chart's controlPlane.auth.loginURL."
  type        = string
  default     = "swa-server-kind"
}

variable "kind_cluster" {
  description = "kind cluster name used in nodeAttestor.k8s_psat.cluster on the agent."
  type        = string
  default     = "kind-swa"
}
```

- [ ] **Step 3: `outputs.tf`** (M1 only emits `authn_id`; M2 adds more)

```hcl
output "authn_id" {
  description = "swa_server.kind.authn_id — passed to helm as controlPlane.auth.loginURL."
  value       = swa_server.kind.authn_id
}
```

- [ ] **Step 4: `terraform init`**

```bash
terraform -chdir=platform/terraform init
```

Expected: `Terraform has been successfully initialized!`, `cyberark/swa` listed as installed.

(`terraform validate` will fail until Task 8 and Task 9 add the actual resources — defer.)

- [ ] **Step 5: Commit**

```bash
git add platform/terraform/main.tf platform/terraform/variables.tf platform/terraform/outputs.tf
git commit -m "feat(m1): terraform module skeleton (provider, vars, outputs)"
```

---

## Task 8: `10-spiffe.tf` — trust domain, server group, node group (spec §7.1, §8.3)

**Files:**
- Create: `platform/terraform/10-spiffe.tf`

Attribute names below reflect the conventional shape from the SWA docs (`service_account_allow_list`, SPIFFE ID template, `k8s_psat` attestor type). **Cross-check against `SCHEMA.md` from Task 6 before applying** — if the attribute is named differently in the bundled schema, use the discovered name.

- [ ] **Step 1: Create `10-spiffe.tf`**

```hcl
# 10-spiffe.tf — SPIFFE hierarchy on the SaaS tenant.
# Order: trust_domain → server_group → node_group.

resource "swa_trust_domain" "idira" {
  name = var.trust_domain
}

resource "swa_server_group" "kind_sg" {
  trust_domain = swa_trust_domain.idira.name
  name         = var.server_group

  node_attestor = {
    type = "k8s_psat"
    k8s_psat = {
      cluster                   = var.kind_cluster
      # Allow the swa-agent service account (helm chart default location) to
      # PSAT-attest. The agent mounts a projected token with this audience
      # at /var/run/secrets/swa/serviceaccount/token.
      service_account_allow_list = ["swa-system:swa-agent"]
      audience                   = "swa-server"
    }
  }
}

resource "swa_node_group" "kind_ng" {
  trust_domain = swa_trust_domain.idira.name
  server_group = swa_server_group.kind_sg.name
  name         = var.node_group

  # SPIFFE ID template for workloads attested under this node group.
  # The `kind-ng` segment is the node-group name and is part of every
  # workload's identity by design (spec §8.3, swa-docs node-groups-design).
  workload_id_template = "spiffe://${var.trust_domain}/${var.node_group}/ns/{{.NamespaceName}}/sa/{{.ServiceAccountName}}"
}
```

- [ ] **Step 2: Validate**

```bash
terraform -chdir=platform/terraform validate
```

Expected: `Success! The configuration is valid.` If it complains about an unknown attribute, fix the name against `SCHEMA.md` and re-run.

- [ ] **Step 3: Commit**

```bash
git add platform/terraform/10-spiffe.tf
git commit -m "feat(m1): tf 10-spiffe — trust domain, server group, node group"
```

---

## Task 9: `20-server.tf` — server with inline JWKS (spec §7.3)

**Files:**
- Create: `platform/terraform/20-server.tf`

Why inline JWKS: the SaaS tenant cannot reach a laptop's kind API server to fetch `jwks_uri`, so the registration must embed the JWKS content via `public_keys`. Source is the kind cluster itself via `scripts/kind-oidc.sh`.

- [ ] **Step 1: Create `20-server.tf`**

```hcl
# 20-server.tf — register the kind cluster as an SWA server using inline JWKS.
# kind-oidc.sh runs `kubectl get --raw` to pull the cluster's discovery + JWKS
# and returns them as flat strings for Terraform's `external` data source.

data "external" "kind_oidc" {
  program = ["bash", "${path.module}/../../scripts/kind-oidc.sh"]
}

resource "swa_server" "kind" {
  trust_domain = swa_trust_domain.idira.name
  server_group = swa_server_group.kind_sg.name
  name         = var.server_name

  authentication = {
    type = "jwt"
    data = {
      issuer      = data.external.kind_oidc.result.issuer
      public_keys = data.external.kind_oidc.result.public_keys
      # Deliberately no jwks_uri — tenant cannot reach the laptop.
    }
  }
}
```

- [ ] **Step 2: Validate (kind not yet up — `external` data source runs at plan/apply time, so this should validate fine)**

```bash
terraform -chdir=platform/terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add platform/terraform/20-server.tf
git commit -m "feat(m1): tf 20-server — register kind cluster with inline jwks"
```

---

## Task 10: Make target `cluster` — kind up

**Files:**
- Modify: `Makefile` (add `cluster` target)

- [ ] **Step 1: Add target**

```make
.PHONY: cluster

cluster: ## Create the kind cluster ($(KIND_CLUSTER))
	@if kind get clusters | grep -qx "$(KIND_CLUSTER)"; then \
	  echo "kind cluster '$(KIND_CLUSTER)' already exists — skipping create"; \
	else \
	  kind create cluster --name $(KIND_CLUSTER) --image kindest/node:v1.34.0; \
	fi
	kubectl cluster-info --context kind-$(KIND_CLUSTER) >/dev/null
```

- [ ] **Step 2: Run it**

```bash
make cluster
```

Expected: kind creates a cluster (~30s) or reports already exists. `kubectl cluster-info` succeeds.

- [ ] **Step 3: Smoke-test `kind-oidc.sh` against the live cluster**

```bash
./scripts/kind-oidc.sh | jq .
```

Expected: a JSON object with two keys, `issuer` (a `https://…` URL) and `public_keys` (a string that starts with `{"keys":[`).

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat(m1): add cluster make target (kind v1.34)"
```

---

## Task 11: Make target `images` — load bundle tarballs into kind

**Files:**
- Modify: `Makefile` (add `images` target)

- [ ] **Step 1: Add target**

```make
.PHONY: images

images: ## Load bundled SWA images into the kind cluster
	$(MAKE) -C swa-release-1.0.4 kind-load-images KIND_CLUSTER=$(KIND_CLUSTER)
```

(The bundle's Makefile has a `kind-load-images` target that runs `kind load image-archive` for each tarball after `docker image load`-ing them. We delegate.)

- [ ] **Step 2: Run it**

```bash
make images
```

Expected: for each tarball, the bundle prints `Loaded image: …` then `Image: "…" with ID "sha256:…" not yet present on node "$KIND_CLUSTER-control-plane", loading…`. Takes 1-2 minutes for both arches. Verify:

```bash
docker exec ${KIND_CLUSTER:-swa}-control-plane crictl images | grep swa
```

Expected: two lines, one `swa-server` and one `swa-agent`, both tagged `0.0.0-SNAPSHOT-arm64v8` (and the amd64 ones if the bundle's target loads both — present but unused on Apple Silicon).

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "feat(m1): add images make target (delegates to bundle's kind-load-images)"
```

---

## Task 12: Make target `tf-apply-platform` — apply 10- and 20- only

**Files:**
- Modify: `Makefile` (add `tf-init`, `tf-apply-platform`)

The two-apply pattern (spec §7.2) means M1 applies 10- and 20- (platform-side resources) but **not** 30-/40-/50- (those need the carrier service running, which is M2). `-target` is used to scope the apply.

- [ ] **Step 1: Add targets**

```make
.PHONY: tf-init tf-apply-platform

tf-init: install-tf-provider ## terraform init (after provider is installed)
	$(TF) init -upgrade

tf-apply-platform: _check-env tf-init ## Apply TF subset #1: SPIFFE hierarchy + server registration
	@$(SUMMON) -- bash -c 'CONJUR_APPLIANCE_URL=$(PANW_SM_URL) CONJUR_AUTHN_TOKEN=$$(./scripts/get-sm-token.sh) $(TF) apply -auto-approve -target=swa_trust_domain.idira -target=swa_server_group.kind_sg -target=swa_node_group.kind_ng -target=swa_server.kind'
	@$(TF) output -json | jq -r '"authn_id = " + .authn_id.value'
```

- [ ] **Step 2: Run it (requires kind up from Task 10)**

```bash
make tf-apply-platform
```

Expected: TF plans 4 resources to add, applies them, prints `Apply complete! Resources: 4 added, 0 changed, 0 destroyed.` then the captured `authn_id = …` line. If apply errors with `403 Forbidden`, the SM token expired between `get-sm-token.sh` and provider call — re-run; it's idempotent on the trust domain (TF will read state and skip).

- [ ] **Step 3: Sanity check via the SaaS API**

```bash
eval "$(make tf-token)"
curl -fsSL "$CONJUR_APPLIANCE_URL/api/swa/trust-domains/idira.demo" \
  -H "Authorization: Token token=\"$CONJUR_AUTHN_TOKEN\"" \
  -H 'Accept: application/x.secretsmgr.v2+json' | jq .name
```

Expected: `"idira.demo"`.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat(m1): add tf-init and tf-apply-platform make targets (two-apply pattern, subset #1)"
```

---

## Task 13: Helm values template for `swa-server` (spec §8.2)

**Files:**
- Create: `platform/helm/swa-server.values.yaml.tmpl`

**Critical:** the bundled chart has **no** `trustDomain.name` key on the server side. The trust-domain identity lives on the control plane (TF) and on the agent (Task 16). Spec §8.2 lines 233-236 documents this; upstream public Helm docs are inaccurate for the bundled chart.

- [ ] **Step 1: Create the template**

```yaml
# swa-server.values.yaml.tmpl — rendered via `envsubst` into swa-server.values.yaml.
# Env vars consumed: PANW_SM_URL, SWA_AUTHN_ID.
image:
  repository: swa-server
  tag: 0.0.0-SNAPSHOT-arm64v8
  pullPolicy: IfNotPresent

controlPlane:
  url: ${PANW_SM_URL}                 # https://infamous.secretsmgr.cyberark.cloud
  auth:
    loginURL: ${SWA_AUTHN_ID}         # tf output `authn_id`
    audience: conjur                  # chart default; pinned so it stays in sync with spec §6.3

rbac:
  createTokenReviewRole: true          # required by k8s_psat node attestor
```

- [ ] **Step 2: Render once for verification**

```bash
eval "$(make tf-token)"
export PANW_SM_URL=https://$PANW_SM_TENANT.secretsmgr.cyberark.cloud
export SWA_AUTHN_ID=$(terraform -chdir=platform/terraform output -raw authn_id)
envsubst < platform/helm/swa-server.values.yaml.tmpl > platform/helm/swa-server.values.yaml
cat platform/helm/swa-server.values.yaml
```

Expected: rendered values have a real `https://…` URL and a real `loginURL`, no `${…}` left over.

- [ ] **Step 3: `helm lint`**

```bash
tar xzf swa-release-1.0.4/helm/swa-server-0.1.0.tgz -C /tmp/
helm lint /tmp/swa-server -f platform/helm/swa-server.values.yaml
```

Expected: `1 chart(s) linted, 0 chart(s) failed`.

- [ ] **Step 4: Commit**

```bash
git add platform/helm/swa-server.values.yaml.tmpl
git commit -m "feat(m1): swa-server helm values template (no trustDomain on server side)"
```

---

## Task 14: Make target `install-server`

**Files:**
- Modify: `Makefile` (add `install-server`)

- [ ] **Step 1: Add target**

```make
.PHONY: install-server

install-server: tf-apply-platform ## Render values and install/upgrade swa-server
	@PANW_SM_URL=$(PANW_SM_URL) \
	  SWA_AUTHN_ID=$$($(TF) output -raw authn_id) \
	  envsubst < platform/helm/swa-server.values.yaml.tmpl \
	  > platform/helm/swa-server.values.yaml
	helm upgrade --install swa-server swa-release-1.0.4/helm/swa-server-0.1.0.tgz \
	  --namespace swa-system --create-namespace \
	  -f platform/helm/swa-server.values.yaml \
	  --wait --timeout 3m
```

- [ ] **Step 2: Run it**

```bash
make install-server
```

Expected: helm reports `Release "swa-server" has been installed`; `--wait` blocks until the deployment's pods are Ready. Verify:

```bash
kubectl -n swa-system get deploy swa-server
kubectl -n swa-system logs deploy/swa-server --tail=20 | grep -i 'authenticat\|listening'
```

Expected: `swa-server` shows `READY 1/1`; log shows a line containing `Successfully authenticated` (or equivalent — the server validates its projected SA token against the tenant on startup).

If the pod is `CrashLoopBackOff`, common causes:
- `controlPlane.auth.loginURL` doesn't match the actual `authn_id` (re-run `tf-apply-platform` and re-render values).
- Provider returned a stale token. Re-run `install-server` (it re-fetches).
- `rbac.createTokenReviewRole=false` was accidentally set — confirm Step 1's template.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "feat(m1): add install-server make target (helm upgrade --install --wait)"
```

---

## Task 15: Helm values template for `swa-agent` — with RSA override (spec §6.3, §8.2)

**Files:**
- Create: `platform/helm/swa-agent.values.yaml.tmpl`

**Critical:** the SM JWT authenticator rejects EC-signed JWTs. The agent chart defaults `agent.key.type` and `workload.key.type` to `ECP256`; both must be overridden to `RSA2048`. Spec §6.3 line 144 lists the fallback enum strings to try if the chart rejects `RSA2048`: `rsa-2048`, then `RSA-2048`.

- [ ] **Step 1: Create the template**

```yaml
# swa-agent.values.yaml.tmpl — rendered via `envsubst` (no env vars consumed yet,
# but kept as .tmpl for symmetry with swa-server and for M2's potential additions).

image:
  repository: swa-agent
  tag: 0.0.0-SNAPSHOT-arm64v8
  pullPolicy: IfNotPresent

trustDomain:
  name: idira.demo

server:
  address: swa-server.swa-system.svc.cluster.local:8443

nodeAttestor:
  type: k8s_psat
  k8s_psat:
    cluster: kind-swa

# CRITICAL — chart defaults are ECP256. SM JWT authenticator rejects EC-signed
# JWTs. RSA is required for workload SVIDs to authenticate to SM. Spec §6.3.
agent:
  key:
    type: RSA2048
workload:
  key:
    type: RSA2048

podLabels:
  swa_nodegroup: kind-ng
```

- [ ] **Step 2: Render and lint**

```bash
envsubst < platform/helm/swa-agent.values.yaml.tmpl > platform/helm/swa-agent.values.yaml
tar xzf swa-release-1.0.4/helm/swa-agent-0.1.0.tgz -C /tmp/
helm lint /tmp/swa-agent -f platform/helm/swa-agent.values.yaml
```

Expected: `1 chart(s) linted, 0 chart(s) failed`.

- [ ] **Step 3: Pre-render with helm and confirm RSA is consumed**

```bash
helm template swa-agent /tmp/swa-agent -f platform/helm/swa-agent.values.yaml \
  | grep -A2 -E 'agent_key|workload_key|key_type|RSA' | head -40
```

Expected: rendered ConfigMap contains `RSA2048` for both `agent.key.type` and `workload.key.type`. If the rendered output still shows `ECP256`, the chart's value key names differ from what spec §8.2 assumed — open `/tmp/swa-agent/templates/configmap.yaml` and find the actual paths, then update `swa-agent.values.yaml.tmpl` to match. Spec §6.3 fallback: try `rsa-2048`, then `RSA-2048`.

- [ ] **Step 4: Commit**

```bash
git add platform/helm/swa-agent.values.yaml.tmpl
git commit -m "feat(m1): swa-agent helm values template with rsa key override (required for sm jwt authn)"
```

---

## Task 16: Make target `install-agent`

**Files:**
- Modify: `Makefile` (add `install-agent`)

- [ ] **Step 1: Add target**

```make
.PHONY: install-agent

install-agent: install-server ## Install/upgrade swa-agent (depends on server being up)
	@envsubst < platform/helm/swa-agent.values.yaml.tmpl \
	  > platform/helm/swa-agent.values.yaml
	helm upgrade --install swa-agent swa-release-1.0.4/helm/swa-agent-0.1.0.tgz \
	  --namespace swa-system \
	  -f platform/helm/swa-agent.values.yaml \
	  --wait --timeout 3m
```

- [ ] **Step 2: Run it**

```bash
make install-agent
```

Expected: helm reports installed; `--wait` blocks until the DaemonSet's pod (1, for a single-node kind cluster) is Ready. Verify:

```bash
kubectl -n swa-system get ds swa-agent
kubectl -n swa-system logs ds/swa-agent --tail=20 | head -40
```

Expected: `DESIRED 1 / READY 1`; logs show the agent connecting to the server and bootstrapping. If the agent CrashLoopBackOffs, look for `k8s_psat` errors in agent logs and `TokenReview denied` in server logs — these signal the `service_account_allow_list` in Task 8 doesn't match (`swa-system:swa-agent`).

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "feat(m1): add install-agent make target"
```

---

## Task 17: Verify RSA workload key override is in effect (validator focus, spec §14.1)

**Files:** none modified.

This is the validator's smoke check from spec §14.1: the agent's rendered ConfigMap shows `RSA2048` for the workload key type, not the chart default `ECP256`.

- [ ] **Step 1: Inspect the live ConfigMap**

```bash
kubectl -n swa-system get cm -o name | grep -i agent
```

Identify the agent's ConfigMap name (typically `swa-agent` or `swa-agent-config`).

```bash
cm=$(kubectl -n swa-system get cm -o name | grep -i agent | head -1)
kubectl -n swa-system get "$cm" -o jsonpath='{.data}' | tr ',' '\n' | grep -i 'key\|rsa\|ecp'
```

Expected: shows `RSA2048` for the workload key type entry. If it shows `ECP256`, the override didn't land — go back to Task 15 and try fallback enum strings.

- [ ] **Step 2: Commit (likely empty — no file changes; document the verification in case it fails)**

```bash
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A && git commit -m "fix(m1): adjust rsa key override enum string for bundled agent chart"
fi
```

---

## Task 18: M1 smoketest script (spec §14.1)

**Files:**
- Create: `scripts/smoke-m1.sh`
- Modify: `Makefile` (add `smoke-m1` target)

- [ ] **Step 1: Create `scripts/smoke-m1.sh`**

```bash
#!/usr/bin/env bash
# smoke-m1.sh — M1 acceptance check (spec §14.1).
# Hard fails on any deviation.
set -euo pipefail

ns=swa-system
fail=0

step() { printf '\n== %s ==\n' "$*"; }
ok()   { printf '  [ok]   %s\n' "$*"; }
err()  { printf '  [FAIL] %s\n' "$*"; fail=$((fail+1)); }

step 'swa-server deployment ready'
ready=$(kubectl -n $ns get deploy swa-server -o jsonpath='{.status.readyReplicas}')
[[ "$ready" == "1" ]] && ok "readyReplicas=1" || err "readyReplicas=$ready"

step 'swa-agent daemonset desired==ready'
desired=$(kubectl -n $ns get ds swa-agent -o jsonpath='{.status.desiredNumberScheduled}')
ready=$(  kubectl -n $ns get ds swa-agent -o jsonpath='{.status.numberReady}')
[[ "$desired" == "$ready" && "$ready" != "0" ]] \
  && ok "desired=$desired ready=$ready" \
  || err "desired=$desired ready=$ready"

step 'swa-server logs contain authentication success'
if kubectl -n $ns logs deploy/swa-server --tail=200 | grep -qiE 'successfully authenticat|control.plane.*ok'; then
  ok 'server authenticated to control plane'
else
  err 'no successful authentication in last 200 log lines'
fi

step 'swa-agent logs contain server handshake success'
if kubectl -n $ns logs ds/swa-agent --tail=200 | grep -qiE 'attestation.*succ|node.*attested|svid.*issued|joined'; then
  ok 'agent attested to server'
else
  err 'no attestation success in last 200 agent log lines'
fi

step 'workload key type is RSA (not EC) in agent configmap'
cm=$(kubectl -n $ns get cm -o name | grep -i agent | head -1)
data=$(kubectl -n $ns get "$cm" -o jsonpath='{.data}' 2>/dev/null || echo '')
if grep -qi 'RSA' <<<"$data" && ! grep -qi 'ECP' <<<"$data"; then
  ok 'RSA present, no ECP'
else
  err 'expected RSA, found: '"$(grep -oE '[A-Z]+[0-9]+' <<<"$data" | sort -u | xargs)"
fi

step 'SaaS trust-domain reachable and matches'
eval "$(make tf-token)"
td=$(curl -fsSL "$CONJUR_APPLIANCE_URL/api/swa/trust-domains/idira.demo" \
  -H "Authorization: Token token=\"$CONJUR_AUTHN_TOKEN\"" \
  -H 'Accept: application/x.secretsmgr.v2+json' | jq -er .name)
[[ "$td" == "idira.demo" ]] && ok "tenant has trust_domain=$td" || err "got td=$td"

echo
if (( fail == 0 )); then
  echo 'M1 smoketest PASS.'
  exit 0
else
  echo "M1 smoketest FAIL ($fail check(s) failed)."
  exit 1
fi
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/smoke-m1.sh
```

- [ ] **Step 3: Add Make target**

```make
.PHONY: smoke-m1

smoke-m1: ## Run M1 acceptance check
	@./scripts/smoke-m1.sh
```

- [ ] **Step 4: Run it**

```bash
make smoke-m1
```

Expected: every step prints `[ok]`, final line `M1 smoketest PASS.`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-m1.sh Makefile
git commit -m "feat(m1): add smoke-m1 acceptance check and make target"
```

---

## Task 19: M1 `up` target (composite)

**Files:**
- Modify: `Makefile` (add `up-m1`)

`make up` for the whole demo is added in M3 (it'll chain M1+M2+M3 targets). For M1's own validation we expose `up-m1` so the validator can run a single command from a clean slate.

- [ ] **Step 1: Add target**

```make
.PHONY: up-m1

up-m1: doctor cluster images tf-apply-platform install-server install-agent smoke-m1 ## Full M1 deploy + smoketest
	@echo
	@echo 'M1 ready. Server + agent healthy, SPIFFE hierarchy registered on tenant.'
	@echo 'Next: M2 plan (carrier service + secret).'
```

- [ ] **Step 2: Test from a clean slate**

```bash
make down                                       # remove any prior state
make up-m1                                      # full M1 from scratch
```

Expected: all M1 targets run in sequence, `make smoke-m1` PASSes at the end, total wall time ≈ 2-3 min after `images` finishes.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "feat(m1): add up-m1 composite target (doctor → cluster → images → tf → helm → smoke)"
```

---

## Task 20: Validator can fully tear down (spec §13.4 criterion 10)

**Files:** none. Verification only.

Spec §13.4 criterion 10 ("Cleanup leaves no trace") requires that after `make down`, `terraform state list` is empty and `kubectl get ns` shows no `swa-system`. The `down` target was scaffolded in Task 1; this task verifies it works.

- [ ] **Step 1: Tear down**

```bash
make down
```

Expected: `helm uninstall` runs (succeeds or no-ops), `kubectl delete ns` runs, `kind delete cluster` removes the cluster, `terraform destroy` removes 4 resources from the tenant.

- [ ] **Step 2: Verify clean**

```bash
# kind cluster gone
kind get clusters | grep -q "^${KIND_CLUSTER:-swa}$" \
  && { echo 'FAIL: kind cluster still present'; exit 1; } \
  || echo '[ok] kind cluster gone'

# TF state empty
test "$(terraform -chdir=platform/terraform state list 2>/dev/null | wc -l | tr -d ' ')" = "0" \
  && echo '[ok] TF state empty' \
  || { echo 'FAIL: TF state still has resources'; terraform -chdir=platform/terraform state list; exit 1; }

# Tenant has no trust_domain (best-effort — may 404 instead of empty list depending on API)
eval "$(make tf-token)"
http=$(curl -s -o /dev/null -w '%{http_code}' \
  "$CONJUR_APPLIANCE_URL/api/swa/trust-domains/idira.demo" \
  -H "Authorization: Token token=\"$CONJUR_AUTHN_TOKEN\"" \
  -H 'Accept: application/x.secretsmgr.v2+json')
[[ "$http" == "404" || "$http" == "403" ]] \
  && echo "[ok] tenant returns $http for deleted trust_domain" \
  || echo "WARN: trust_domain endpoint returns $http (expected 404)"
```

Expected: all three checks `[ok]`. If TF state isn't empty, manually `terraform -chdir=platform/terraform destroy -auto-approve` after re-sourcing `tf-token`.

- [ ] **Step 3: Run `make up-m1` again to confirm idempotency**

```bash
make up-m1
```

Expected: completes successfully, M1 smoketest passes.

- [ ] **Step 4: Tear down a final time, leave clean for M2**

```bash
make down
```

- [ ] **Step 5: No commit (verification only).**

---

## M1 done — handoff to M2

Once Task 20 PASSes, M1 is complete. The validator subagent (spec §13.5/§13.6) grades the M1 diff against §13.4. If 9/10 or higher, the M2 plan (`2026-05-27-idira-swa-demo-m2-backend.md`) is the next document.

**State for M2 to assume present:**
- `swa-release-1.0.4/` bundle (unchanged).
- `.envrc` with tenant credentials.
- `scripts/{doctor,get-sm-token,kind-oidc,smoke-m1}.sh`.
- `platform/terraform/{main,variables,outputs,10-spiffe,20-server}.tf`.
- `platform/helm/swa-{server,agent}.values.yaml.tmpl`.
- `Makefile` with: `help doctor tf-token down cluster images install-tf-provider tf-init tf-apply-platform install-server install-agent smoke-m1 up-m1 _check-env`.

M2 will add `30-jwt-authn.tf`, `40-policy.tf`, `50-secret.tf` (TF apply #2 — depends on carrier being deployed), the `carrier` Go service, and a portal stub for the M2 smoketest.
