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
.PHONY: help doctor tf-token down install-tf-provider cluster images \
        tf-init tf-apply-platform install-server install-agent smoke-m1 \
        up-m1 _check-env

help: ## Show this help
	@awk 'BEGIN{FS=":.*##"} /^[a-zA-Z0-9_-]+:.*##/{printf "  %-22s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

doctor: ## Verify prerequisites
	@./scripts/doctor.sh

_check-env:
	@: "$${PANW_SM_TENANT:?set in .envrc}"

tf-token: _check-env ## Print env exports to source for manual `terraform` use
	@echo "export CONJUR_APPLIANCE_URL=$(PANW_SM_URL)"
	@printf 'export CONJUR_AUTHN_TOKEN=%s\n' "$$($(SUMMON) -- ./scripts/get-sm-token.sh)"

install-tf-provider: ## Install cyberark/swa terraform provider from the bundle
	cd swa-release-1.0.4 && ./install-terraform-provider.sh
	@# Defang macOS Gatekeeper quarantine if present (see DEPLOY_MACOS.md).
	-xattr -d com.apple.quarantine \
	  ~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/*/darwin_arm64/terraform-provider-swa_* \
	  2>/dev/null || true

images: ## Load bundled SWA images + busybox (init containers) into kind
	$(MAKE) -C swa-release-1.0.4 kind-load-images KIND_CLUSTER=$(KIND_CLUSTER)
	@# Both chart's init containers use busybox:latest with imagePullPolicy:
	@# IfNotPresent. On a laptop where the kubelet inherits HTTP_PROXY from
	@# the host (Docker Desktop common case), the proxy at 127.0.0.1:8080 is
	@# unreachable from inside the kind node, so the pull silently fails.
	@# Preloading busybox into kind avoids the pull entirely.
	@docker image inspect busybox:latest >/dev/null 2>&1 || docker pull busybox:latest
	kind load docker-image busybox:latest --name $(KIND_CLUSTER)

tf-init: install-tf-provider ## terraform init (after provider is installed)
	$(TF) init -upgrade

# tf-apply-platform — apply only the platform-side subset (10-spiffe + 20-server).
# Workload-side resources (30/40/50) belong to M2 and are not present yet.
# `-target` is used per spec §7.2 (two-apply pattern).
# The CONJUR_AUTHN_TOKEN is captured once into a $$tok shell var so it isn't
# echoed on the command line (visible to `ps`); summon injects the underlying
# CLIENT_ID/CLIENT_SECRET from Keychain via conceal_summon.
tf-apply-platform: _check-env tf-init ## Apply TF subset #1: SPIFFE hierarchy + server registration
	@$(SUMMON) -- bash -c '\
	  set -euo pipefail; \
	  tok=$$(./scripts/get-sm-token.sh); \
	  CONJUR_APPLIANCE_URL=$(PANW_SM_URL) CONJUR_AUTHN_TOKEN=$$tok \
	    $(TF) apply -auto-approve \
	      -target=swa_trust_domain.idira \
	      -target=swa_server_group.kind_sg \
	      -target=swa_node_group.kind_ng \
	      -target=swa_server.kind'
	@$(TF) output -json | jq -r '"login_url = " + .login_url.value'

install-server: tf-apply-platform ## Render values and install/upgrade swa-server (waits for ready)
	@PANW_SM_URL=$(PANW_SM_URL) \
	  SWA_LOGIN_URL=$$($(TF) output -raw login_url) \
	  envsubst < platform/helm/swa-server.values.yaml.tmpl \
	  > platform/helm/swa-server.values.yaml
	helm upgrade --install swa-server swa-release-1.0.4/helm/swa-server-0.1.0.tgz \
	  --namespace swa-system --create-namespace \
	  -f platform/helm/swa-server.values.yaml \
	  --wait --timeout 3m

install-agent: install-server ## Install/upgrade swa-agent (depends on server being up)
	@envsubst < platform/helm/swa-agent.values.yaml.tmpl \
	  > platform/helm/swa-agent.values.yaml
	helm upgrade --install swa-agent swa-release-1.0.4/helm/swa-agent-0.1.0.tgz \
	  --namespace swa-system \
	  -f platform/helm/swa-agent.values.yaml \
	  --wait --timeout 3m

smoke-m1: _check-env ## M1 acceptance check (spec §14.1). Exit 0 = PASS.
	@./scripts/smoke-m1.sh

# up-m1 — full M1 from a clean slate. The dependency chain runs each step
# in order (doctor → cluster → images → tf → helm → smoke). `make up` for
# the whole demo is added in M3 (chains M1+M2+M3 targets); M1 exposes its
# own composite so the validator can run a single command.
up-m1: doctor cluster images tf-apply-platform install-server install-agent smoke-m1 ## Full M1 deploy + smoketest from clean slate
	@echo
	@echo 'M1 ready. Server + agent healthy, SPIFFE hierarchy registered on tenant.'
	@echo 'Next: M2 plan (carrier service + secret).'

cluster: ## Create the kind cluster ($(KIND_CLUSTER)) if not present
	@if kind get clusters | grep -qx "$(KIND_CLUSTER)"; then \
	  echo "kind cluster '$(KIND_CLUSTER)' already exists — skipping create"; \
	else \
	  kind create cluster --name $(KIND_CLUSTER) --image kindest/node:v1.34.0; \
	fi
	@kubectl cluster-info --context kind-$(KIND_CLUSTER) >/dev/null
	@echo "kind cluster '$(KIND_CLUSTER)' ready (context: kind-$(KIND_CLUSTER))"

down: _check-env ## Tear down everything (cluster + tenant TF state). Best-effort.
	-helm -n swa-system uninstall swa-agent swa-server 2>/dev/null
	@# Destroy TF BEFORE kind delete: data.external.kind_oidc refresh runs
	@# `kubectl --raw /openid/v1/jwks` against the kind cluster, and TF
	@# refreshes data sources during destroy. Killing the cluster first
	@# makes the refresh fail and the destroy stops with state intact.
	@# `-refresh=false` is a belt-and-suspenders defense in case someone
	@# nukes the cluster out-of-band before running `make down`.
	-$(SUMMON) -- bash -c 'set -euo pipefail; tok=$$(./scripts/get-sm-token.sh); CONJUR_APPLIANCE_URL=$(PANW_SM_URL) CONJUR_AUTHN_TOKEN=$$tok $(TF) destroy -auto-approve -refresh=false'
	-kubectl delete ns swa-demo swa-system --wait=false 2>/dev/null
	-kind delete cluster --name $(KIND_CLUSTER)

.PHONY: tf-apply-app build-apps deploy-apps smoke-m2 up-m2

# --- M2 targets (real bodies added by later M2 tasks) ---

tf-apply-app: _check-env tf-init ## Apply TF subset #2 (authn-jwt, policy, secret) — needs carrier deployed
	@echo 'tf-apply-app: stub — implemented in M2 Task 13'

build-apps: ## Build the demo app images locally
	@echo 'build-apps: stub — implemented in M2 Task 8'

deploy-apps: ## Deploy demo app manifests into swa-demo
	@echo 'deploy-apps: stub — implemented in M2 Task 10/14'

smoke-m2: ## Run M2 acceptance check
	@./scripts/smoke-m2.sh

up-m2: up-m1 build-apps deploy-apps tf-apply-app smoke-m2 ## Full M2 deploy + smoketest
	@echo 'M2 ready.'
