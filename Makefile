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
