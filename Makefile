SHELL := bash
.SHELLFLAGS := -euo pipefail -c

# Required env (sourced from .envrc):
#   PANW_SM_TENANT       (SM SaaS subdomain -- see .envrc.example)
#   CONCEAL_NAMESPACE    (macOS Keychain namespace holding client_id+client_secret)
# Optional:
#   KIND_CLUSTER         (default "swa")
#
# Secrets are NOT in env. Credentials live in macOS Keychain via Conceal and
# are injected into tenant-touching commands via $(SUMMON) (see below).
KIND_CLUSTER    ?= swa
PANW_SM_URL     := https://$(PANW_SM_TENANT).secretsmgr.cyberark.cloud
TF              := terraform -chdir=platform/terraform
# SWA release is shipped as a TGZ; `make unpack` extracts it here on demand.
# The tarball filename is configurable via .envrc ($SWA_RELEASE_TGZ).
SWA_RELEASE_DIR := .swa-release

# SUMMON wraps a command, injecting CLIENT_ID + CLIENT_SECRET into its env from
# Conceal-backed macOS Keychain. Provider flag is `conceal_summon` (not
# `conceal`). The Keychain namespace is parameterized via $(CONCEAL_NAMESPACE)
# -- `make _check-env` requires it. printf builds the YAML at call time so
# $(CONCEAL_NAMESPACE) is properly Make-expanded into both `!var` lines.
SUMMON = summon -p conceal_summon --yaml "$$(printf 'CLIENT_ID: !var %s/client_id\nCLIENT_SECRET: !var %s/client_secret' '$(CONCEAL_NAMESPACE)' '$(CONCEAL_NAMESPACE)')"

.DEFAULT_GOAL := help
.PHONY: help setup doctor tf-token down install-tf-provider cluster images \
        tf-init tf-apply-platform install-server install-agent smoke-m1 \
        up-m1 _check-env unpack migrate-from-1.0.4 clean-orphans

help: ## Show this help
	@awk 'BEGIN{FS=":.*##"} /^[a-zA-Z0-9_-]+:.*##/{printf "  %-22s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: ## First-time guided onboarding (installs tools, builds .envrc, stores secrets)
	@./scripts/setup.sh $(SETUP_FLAGS)

doctor: ## Verify prerequisites
	@./scripts/doctor.sh

unpack: ## Extract the SWA release TGZ into $(SWA_RELEASE_DIR) (idempotent)
	@./scripts/unpack-release.sh

migrate-from-1.0.4: ## Detect a stale swa-release-1.0.4/ folder and print cleanup hint
	@if [[ -d swa-release-1.0.4 ]]; then \
	  echo "Found legacy swa-release-1.0.4/ directory. This repo now extracts"; \
	  echo "the release TGZ into $(SWA_RELEASE_DIR)/ instead. Run:"; \
	  echo; \
	  echo "    rm -rf swa-release-1.0.4"; \
	  echo; \
	  echo "(safe -- the contents are vendor-provided and reproducible from"; \
	  echo " the TGZ via 'make unpack')."; \
	else \
	  echo "No legacy swa-release-1.0.4/ folder found. Nothing to do."; \
	fi

_check-env:
	@: "$${PANW_SM_TENANT:?set in .envrc (see .envrc.example)}"
	@: "$${CONCEAL_NAMESPACE:?set in .envrc (see .envrc.example) -- Keychain namespace holding client_id+client_secret}"

tf-token: _check-env ## Print env exports to source for manual `terraform` use
	@echo "export CONJUR_APPLIANCE_URL=$(PANW_SM_URL)"
	@printf 'export CONJUR_AUTHN_TOKEN=%s\n' "$$($(SUMMON) -- ./scripts/get-sm-token.sh)"

install-tf-provider: unpack ## Install cyberark/swa terraform provider from the bundle
	cd $(SWA_RELEASE_DIR) && ./install-terraform-provider.sh
	@# Defang macOS Gatekeeper quarantine if present (see DEPLOY_MACOS.md).
	-xattr -d com.apple.quarantine \
	  ~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/*/darwin_arm64/terraform-provider-swa_* \
	  2>/dev/null || true

images: unpack ## Load bundled SWA images + busybox (init containers) into kind
	$(MAKE) -C $(SWA_RELEASE_DIR) kind-load-images KIND_CLUSTER=$(KIND_CLUSTER)
	@# Both chart's init containers use busybox:latest with imagePullPolicy:
	@# IfNotPresent. On a laptop where the kubelet inherits HTTP_PROXY from
	@# the host (Docker Desktop common case), the proxy at 127.0.0.1:8080 is
	@# unreachable from inside the kind node, so the pull silently fails.
	@# Preloading busybox into kind avoids the pull entirely.
	@docker image inspect busybox:latest >/dev/null 2>&1 || docker pull busybox:latest
	kind load docker-image busybox:latest --name $(KIND_CLUSTER)

tf-init: install-tf-provider ## terraform init (after provider is installed)
	$(TF) init -upgrade

# tf-apply-platform -- apply only the platform-side subset (10-spiffe + 20-server).
# Workload-side resources (30/40/50) come later (see tf-apply-workloads).
# `-target` is used to enforce a deterministic two-apply pattern.
# The CONJUR_AUTHN_TOKEN is captured once into a $$tok shell var so it isn't
# echoed on the command line (visible to `ps`); summon injects the underlying
# CLIENT_ID/CLIENT_SECRET from Keychain via conceal_summon.
tf-apply-platform: _check-env tf-init ## Apply TF subset #1: SPIFFE hierarchy + server registration
	@# var.sm_url is required by 30-jwt-authn.tf. Even though we use
	@# -target to constrain *this* apply to the four SPIFFE resources, TF still
	@# validates every variable in the root module -- so sm_url must be set.
	@$(SUMMON) -- bash -c '\
	  set -euo pipefail; \
	  tok=$$(./scripts/get-sm-token.sh); \
	  CONJUR_APPLIANCE_URL=$(PANW_SM_URL) CONJUR_AUTHN_TOKEN=$$tok \
	    $(TF) apply -auto-approve \
	      -var sm_url=$(PANW_SM_URL) \
	      -target=swa_trust_domain.idira \
	      -target=swa_server_group.kind_sg \
	      -target=swa_node_group.kind_ng \
	      -target=swa_server.kind'
	@$(TF) output -json | jq -r '"authn_id = " + .authn_id.value'

install-server: unpack tf-apply-platform ## Render values and install/upgrade swa-server (waits for ready)
	@PANW_SM_URL=$(PANW_SM_URL) \
	  SWA_AUTHN_ID=$$($(TF) output -raw authn_id) \
	  SWA_IMAGE_TAG=$$(./scripts/derive-image-tag.sh) \
	  envsubst < platform/helm/swa-server.values.yaml.tmpl \
	  > platform/helm/swa-server.values.yaml
	helm upgrade --install swa-server $(SWA_RELEASE_DIR)/helm/swa-server-0.1.0.tgz \
	  --namespace swa-system --create-namespace \
	  -f platform/helm/swa-server.values.yaml \
	  --wait --timeout 3m

install-agent: unpack install-server ## Install/upgrade swa-agent (depends on server being up)
	@SWA_IMAGE_TAG=$$(./scripts/derive-image-tag.sh) \
	  envsubst < platform/helm/swa-agent.values.yaml.tmpl \
	  > platform/helm/swa-agent.values.yaml
	helm upgrade --install swa-agent $(SWA_RELEASE_DIR)/helm/swa-agent-0.1.0.tgz \
	  --namespace swa-system \
	  -f platform/helm/swa-agent.values.yaml \
	  --wait --timeout 3m

smoke-m1: _check-env ## M1 acceptance check. Exit 0 = PASS.
	@./scripts/smoke-m1.sh

# up-m1 -- full M1 from a clean slate. The dependency chain runs each step
# in order (doctor -> cluster -> images -> tf -> helm -> smoke). `make up`
# composes M1+M2+M3 for the full demo; up-m1 exposes a single-command
# entry point for the M1 layer alone.
up-m1: doctor cluster images tf-apply-platform install-server install-agent smoke-m1 ## Full M1 deploy + smoketest from clean slate
	@echo
	@echo 'M1 ready. Server + agent healthy, SPIFFE hierarchy registered on tenant.'
	@echo 'Next: up-m2 (carrier service + secret).'

cluster: ## Create the kind cluster ($(KIND_CLUSTER)) if not present
	@if kind get clusters | grep -qx "$(KIND_CLUSTER)"; then \
	  echo "kind cluster '$(KIND_CLUSTER)' already exists -- skipping create"; \
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
	@#
	@# M2 carryover fix (2026-05-27): a single-shot destroy stranded 8 TF
	@# resources because the SM auth token expired mid-destroy (SM tokens
	@# are ~8min and a full destroy can outrun that on a slow tenant). The
	@# tenant also intermittently returns 409 "Concurrent policy load" when
	@# unrelated resources are being torn down in the same batch. Both
	@# failure modes are transient -- re-running `make down` cleans them up.
	@# Bake that retry into the recipe: up to 3 attempts, each gets a fresh
	@# token, and we stop as soon as `terraform state list` is empty.
	@# Loop body factored to scripts/tf-destroy-with-retry.sh so `clean-orphans`
	@# reuses the same envelope.
	-@PANW_SM_URL=$(PANW_SM_URL) $(SUMMON) -- ./scripts/tf-destroy-with-retry.sh
	@# Post-destroy tenant check: the retry loop above breaks on local-state
	@# emptiness, NOT on tenant cleanliness. Probe BOTH the SWA trust-domain
	@# AND the conjur policy branch -- either can be orphaned independently
	@# (token-expiry timing during destroy). Warning only; never blocks the
	@# kind/kubectl teardown below.
	-@PANW_SM_URL=$(PANW_SM_URL) $(SUMMON) -- bash -c '\
	  tok=$$(./scripts/get-sm-token-b64.sh); \
	  swa_code=$$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 \
	    "$(PANW_SM_URL)/api/swa/trust-domains/idira.demo" \
	    -H "Authorization: Token token=\"$$tok\"" \
	    -H "Accept: application/x.secretsmgr.v2+json"); \
	  cj_code=$$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 \
	    "$(PANW_SM_URL)/api/resources/conjur/policy/data%2Fswa-demo" \
	    -H "Authorization: Token token=\"$$tok\""); \
	  if [ "$$swa_code" = "200" ] || [ "$$cj_code" = "200" ]; then \
	    echo ""; \
	    echo "WARN: tenant orphans remain after destroy:"; \
	    [ "$$swa_code" = "200" ] && echo "        * swa trust_domain idira.demo present"; \
	    [ "$$cj_code"  = "200" ] && echo "        * conjur policy branch data/swa-demo present"; \
	    echo "      TF state is clean, so re-running \`make down\` will not help."; \
	    echo "      Run \`make clean-orphans\` to reconcile."; \
	  fi'
	-kubectl delete -f platform/k8s/acme.service.yaml    --ignore-not-found
	-kubectl delete -f platform/k8s/acme.deployment.yaml --ignore-not-found
	-kubectl delete -f platform/k8s/acme.namespace.yaml  --ignore-not-found --wait=false
	-kubectl delete ns swa-demo swa-system --wait=false 2>/dev/null
	-kind delete cluster --name $(KIND_CLUSTER)

# clean-orphans -- reconcile tenant-side resources that survived an aborted
# `make down`. Symptom: `make up` fails with HTTP 409 (e.g.
# "Conjur trust_domain with name 'idira.demo' already exists" or
# "secureWorkloadAccess authenticator already exists") even though
# `terraform state list` is empty. Recovery path: restore the managed
# resource blocks from the May-27 snapshot backup into a working state,
# then let the standard destroy-with-retry loop reconcile.
#
# Covers BOTH classes of orphan: SWA (trust_domain, server_group, node_group,
# server) and Conjur (authenticator, policy_branch, secret, permission).
# Both provider families treat DELETE-on-404 as idempotent success (verified
# empirically), so destroying resources the tenant no longer has is harmless
# -- meaning we always restore the full managed set regardless of which ones
# are stranded today.
#
# Refuses to run if local state is non-empty (would clobber a live
# deploy) or if the snapshot backup is missing (nothing to restore).
CLEAN_ORPHANS_BACKUP := platform/terraform/terraform.tfstate.1779923863.backup
clean-orphans: _check-env ## Reconcile tenant-side orphans (use when `make up` 409s on a clean local state)
	@if [ "$$($(TF) state list 2>/dev/null | wc -l | tr -d ' ')" != "0" ]; then \
	  echo "ERROR: terraform state is non-empty -- run \`make down\` first."; \
	  $(TF) state list | sed 's/^/    /'; \
	  exit 1; \
	fi
	@if [ ! -f $(CLEAN_ORPHANS_BACKUP) ]; then \
	  echo "ERROR: $(CLEAN_ORPHANS_BACKUP) is missing"; \
	  echo "       (this is the source of truth for orphan resource IDs)."; \
	  exit 1; \
	fi
	@echo "==> backing up current (empty) state to terraform.tfstate.before-cleanup"
	@cp platform/terraform/terraform.tfstate platform/terraform/terraform.tfstate.before-cleanup
	@echo "==> building restore state with managed resources from the snapshot"
	@# Filter rules:
	@#  * drop data sources (mode != managed) -- -refresh=false makes them no-ops.
	@#  * drop resources with empty instances (nothing to destroy).
	@#  * drop conjur_* resources living under `data/swa/trust-domains/...` --
	@#    those branches are owned by the SWA trust_domain and get cascaded
	@#    when the trust_domain is destroyed. The cyberark/conjur provider
	@#    hard-errors on DELETE-404, so leaving them in would jam the loop.
	@jq '.resources |= map(select(.mode == "managed" and (.instances|length) > 0 and ((.type | startswith("conjur_") | not) or (((.instances[0].attributes.branch // "") | startswith("data/swa/trust-domains/") | not) and ((.instances[0].attributes.full_id // "") | startswith("data/swa/trust-domains/") | not))))) | .outputs = {}' \
	  $(CLEAN_ORPHANS_BACKUP) \
	  > platform/terraform/terraform.tfstate
	@$(TF) state list | sed 's/^/    will attempt destroy: /'
	@echo "==> invoking destroy-with-retry"
	@if PANW_SM_URL=$(PANW_SM_URL) $(SUMMON) -- ./scripts/tf-destroy-with-retry.sh; then \
	  echo "==> tenant reconciled; removing safety backup"; \
	  rm platform/terraform/terraform.tfstate.before-cleanup; \
	else \
	  echo ""; \
	  echo "ERROR: destroy did not empty state after 3 attempts."; \
	  echo "       current (partial) state preserved; rollback with:"; \
	  echo "         cp platform/terraform/terraform.tfstate.before-cleanup \\"; \
	  echo "            platform/terraform/terraform.tfstate"; \
	  exit 1; \
	fi

.PHONY: tf-apply-app build-ui build-apps deploy-apps smoke-m2 up-m2

# --- M2 targets (carrier service + secret) ---

tf-apply-app: _check-env tf-init ## Apply TF subset #2: jwt authn + policy + secret (no -target -- full apply)
	@$(SUMMON) -- bash -c '\
	  set -euo pipefail; \
	  tok=$$(./scripts/get-sm-token.sh); \
	  CONJUR_APPLIANCE_URL=$(PANW_SM_URL) CONJUR_AUTHN_TOKEN=$$tok \
	    $(TF) apply -auto-approve -var sm_url=$(PANW_SM_URL)'
	@$(TF) output -json | jq -r '"carrier_host_id   = " + .carrier_host_id.value, "carrier_secret_id = " + .carrier_secret_id.value'

build-ui: ## Build the portal React/Vite UI into apps/portal/ui/
	cd apps/portal/ui-src && pnpm install --frozen-lockfile && pnpm run build

build-apps: build-ui ## Build the demo app images locally and load into kind
	docker build -t idira/carrier:m2      apps/carrier/
	docker build -t idira/portal:m3       apps/portal/
	docker build -t idira/acme-carrier:m7 apps/acme-carrier/
	kind load docker-image idira/carrier:m2      --name $(KIND_CLUSTER)
	kind load docker-image idira/portal:m3       --name $(KIND_CLUSTER)
	kind load docker-image idira/acme-carrier:m7 --name $(KIND_CLUSTER)

deploy-apps: ## Deploy carrier + portal into swa-demo
	kubectl apply -f platform/k8s/namespace.yaml
	kubectl apply -f platform/k8s/portal.sa.yaml
	@# carrier-config holds the SM URL + variable path the carrier reads.
	@# variable path is the Conjur resource id verbatim -- `data/<branch>/<name>`
	@# (verified empirically 2026-05-27: omitting the `data/` prefix returns
	@# CONJ00076E "variable not found" because Conjur looks up the literal
	@# resource id and there is no record at the bare path).
	@# Stays in lockstep with conjur_secret.carrier_api_key in TF: branch
	@# `/data/swa-demo/carrier` + name `api-key` → resource id
	@# `data/swa-demo/carrier/api-key`.
	@kubectl -n swa-demo create configmap carrier-config \
	  --from-literal=sm_url=$(PANW_SM_URL) \
	  --from-literal=secret_id=data/swa-demo/carrier/api-key \
	  --dry-run=client -o yaml | kubectl apply -f -
	@# M3: retire the M2 portal-stub atomically before bringing up the real
	@# portal. The stub was a plain curl pod under the same `portal` SA -- it
	@# can no longer reach the (now mTLS-only) carrier, and the real portal
	@# Deployment is what smoke-m2 / smoke-m3 talk to from M3 onward.
	-kubectl -n swa-demo delete pod portal-stub --ignore-not-found
	kubectl apply -f platform/k8s/carrier.deployment.yaml
	kubectl apply -f platform/k8s/carrier.service.yaml
	kubectl apply -f platform/k8s/portal.deployment.yaml
	kubectl apply -f platform/k8s/portal.service.yaml
	kubectl -n swa-demo rollout status deploy/carrier --timeout=2m
	kubectl -n swa-demo rollout status deploy/portal  --timeout=2m
	kubectl apply -f platform/k8s/acme.namespace.yaml
	kubectl apply -f platform/k8s/acme.deployment.yaml
	kubectl apply -f platform/k8s/acme.service.yaml
	kubectl -n acme-external rollout status deploy/acme-carrier --timeout=2m

smoke-m2: ## Run M2 acceptance check
	@./scripts/smoke-m2.sh

up-m2: up-m1 build-apps deploy-apps tf-apply-app smoke-m2 ## Full M2 deploy + smoketest
	@echo 'M2 ready.'

.PHONY: portforward smoke-m3 smoke-m7 up smoke readme-shots

PORT ?= 8080
portforward: ## Forward portal to localhost:$(PORT) (override with PORT=, blocks)
	@echo 'Portal at http://localhost:$(PORT) -- Ctrl+C to stop'
	kubectl -n swa-demo port-forward svc/portal $(PORT):8080

readme-shots: ## Capture docs/img/*.png from a live portal (uses :18080)
	@echo 'Capturing README images...'
	@# Use a non-8080 local port to avoid the user's dev proxy.
	@kubectl -n swa-demo port-forward svc/portal 18080:8080 >/dev/null 2>&1 & \
	pf_pid=$$!; \
	trap "kill $$pf_pid >/dev/null 2>&1 || true" EXIT; \
	sleep 2; \
	cd ui-tests && node ../scripts/readme-shots.mjs

smoke-m3: ## Run M3 acceptance check (headless browser)
	@./scripts/smoke-ui.sh

smoke-m7: ## Run M7 acceptance check (foreign-TD rejection + internal regression)
	@./scripts/smoke-m7.sh

# up -- full demo from clean slate. The dependency chain runs each step
# in order (M1 platform → app images → app deploy → app TF → M3 smoke → M7 smoke).
# Uses smoke-m3 + smoke-m7 at the end: m3 exercises the full M1+M2+M3 internal
# stack, m7 exercises the foreign-TD rejection plus an internal regression check.
up: up-m1 build-apps deploy-apps tf-apply-app smoke-m3 smoke-m7 ## Full demo deploy + smoketest
	@echo
	@echo 'Demo ready. Run: make portforward'

# smoke -- runs all four milestone smoketests in order. Use this to spot
# which milestone broke if `make up` ever surprises you.
smoke: smoke-m1 smoke-m2 smoke-m3 smoke-m7 ## Run all milestone smoketests
