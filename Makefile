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
        tf-init tf-apply-platform install-server _check-env

help: ## Show this help
	@awk 'BEGIN{FS=":.*##"} /^[a-zA-Z_-]+:.*##/{printf "  %-22s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

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
	-kubectl delete ns swa-demo swa-system --wait=false 2>/dev/null
	-kind delete cluster --name $(KIND_CLUSTER)
	-$(SUMMON) -- bash -c 'CONJUR_APPLIANCE_URL=$(PANW_SM_URL) CONJUR_AUTHN_TOKEN=$$(./scripts/get-sm-token.sh) $(TF) destroy -auto-approve' 2>/dev/null || true
