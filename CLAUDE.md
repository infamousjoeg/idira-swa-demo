# Maintainer notes -- idira-swa-demo

This file is project guidance for anyone (human or otherwise) working in this repo. It documents the structural facts about the CyberArk Secure Workload Access (SWA) release distribution that this sandbox demonstrates: what the release contains, how to deploy it locally, and how the in-cluster components fit together. The information is not duplicated in README.md (user-facing) or docs/under-the-hood.md (step-by-step walkthrough); both link back here for component-level depth.

## Repository nature

This repo is a sandbox for working with the **CyberArk Secure Workload Access (SWA)** release distribution, not a source-code project. The tracked content is documentation and a Mac deploy guide; the actual release contents live under `swa-release-1.0.4/`, which is **gitignored**. Treat `swa-release-1.0.4/` as a vendor-provided artifact: read it, extract from it, run its scripts, but don't `git add` inside it without also intending to change `.gitignore`.

There is no application code to build, lint, or test here. The commands below are operational: loading container images, installing charts, installing a Terraform provider.

## Onboarding flow (canonical)

A first-time user runs, in order:

- `make setup` (interactive; six phases; installs missing tools via Homebrew
  with consent, builds `.envrc` from `.envrc.example`, stores Service User
  credentials in Keychain via `conceal set`, and as its final phase invokes
  `make doctor` to verify the result).
- `make up` (canonical deploy; M1 + M2 + M3 milestones; depends on
  `make doctor` so it is also a safe trust-but-verify entry point).
- `make portforward PORT=18080` (open the portal on a non-default port
  to avoid common 8080 collisions).

`make doctor` is idempotent and safe to re-run on its own at any time;
because `make setup` and `make up` both invoke it, you rarely need to
call it directly. `scripts/setup.sh` is the source of truth for "how
do I get there"; it does not touch the tenant or run any deploy step.

## Where the knowledge lives

- **[`docs/under-the-hood.md`](docs/under-the-hood.md)** -- runnable end-to-end Mac walkthrough that ties the bundle artifacts to a kind cluster, with both a sandbox path (no tenant) and a full-deploy path (against a Secrets Manager - SaaS tenant). This is the right starting point for any "make SWA work on this laptop" request.
- **[`swa-docs/INDEX.md`](swa-docs/INDEX.md)** -- local mirror of the upstream early-release docs (12 pages from `docs.cyberark.com/early-release/swa/.../conjurcloud/`). Each page in `swa-docs/pages/` keeps its upstream URL in its frontmatter under `source:`. Prefer reading these over re-fetching; if a question turns on something that might be newer than the mirror, refetch the page named in the frontmatter rather than guessing.
- **[`swa-docs/raw/`](swa-docs/raw/)** -- original rendered HTML for each crawled page (JSON-encoded strings, captured via Playwright since the docs site is a JS-rendered MadCap Flare SPA). Keep for traceability; humans should read `pages/*.md`.

## What's in the release

`swa-release-1.0.4/` is a self-contained Kubernetes deployment package for SWA, a SPIFFE-style workload identity / attestation system. Layout:

- `container-images/*.tar` -- pre-built `swa-server` and `swa-agent` images (amd64 + arm64v8) as `docker image load`-able tarballs, originally tagged `0.0.0-SNAPSHOT` with no repository prefix.
- `helm/swa-server-0.1.0.tgz`, `helm/swa-agent-0.1.0.tgz` -- packaged Helm charts. Extract to read `values.yaml`.
- `terraform-provider/` -- `cyberark/swa` Terraform provider binaries for darwin/linux/windows x amd64/arm64, plus `SHA256SUMS` + GPG `.sig`.
- `binaries/` -- standalone `swa-agent` binaries (darwin/linux x amd64/arm64). No server binary; the agent is the only component meant to run outside Kubernetes.
- `install-terraform-provider.sh` / `.ps1` -- install the provider into `~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/<version>/<os>_<arch>/`.
- `Makefile` -- image push/load targets (default goal is `help`).
- `manifest.txt` -- pins the upstream component versions (`swa-services`, `swa-customer-components`) for this release.

## Common operations

All commands run from `swa-release-1.0.4/`.

**Push images to a registry** -- auto-loads each tar via `docker image load`, parses the loaded tag, retags to `$REGISTRY/<image>`, pushes:

```bash
make push-images REGISTRY=<registry-url>
# OpenShift: logs in via `oc whoami -t | docker login`, pushes under $REGISTRY/$OS_PROJECT
make push-openshift-images REGISTRY=<registry-url> OS_PROJECT=swa
# Local kind cluster (no registry needed)
make kind-load-images KIND_CLUSTER=<name>
```

`REGISTRY` defaults to `$(oc registry info)`. Don't pre-tag the tarballs; the Makefile rule does it.

**Install the Terraform provider** -- auto-detects OS/arch, picks the newest matching dir under `terraform-provider/`, copies the binary into the local plugin dir, prints the `required_providers` block:

```bash
./install-terraform-provider.sh                          # or `make install-tf-provider`
./install-terraform-provider.sh --os linux --arch amd64  # cross-install
```

**Install the Helm charts** (both into the `swa-system` namespace):

```bash
helm install swa-server ./helm/swa-server/ \
  --namespace swa-system --create-namespace \
  --set controlPlane.url=<...> \
  --set controlPlane.auth.loginURL=<...> \
  --set rbac.createTokenReviewRole=true

helm install swa-agent ./helm/swa-agent/ \
  --namespace swa-system \
  --set server.address=swa-server.swa-system.svc.cluster.local:8443 \
  --set nodeAttestor.type=k8s_psat \
  --set nodeAttestor.k8s_psat.cluster=<cluster-name>
```

The charts are shipped as `.tgz`. To read defaults:

```bash
tar xzf helm/swa-server-0.1.0.tgz -C /tmp/ && cat /tmp/swa-server/values.yaml
```

## Component architecture

SWA splits into three layers. **You can't do a real end-to-end deploy with the bundle alone**; the control plane is a SaaS tenant the bundle has no copy of.

1. **Control plane (SaaS, not in this bundle).** A CyberArk **Secrets Manager - SaaS** tenant at `https://<subdomain>.secretsmgr.cyberark.cloud`. Holds the SPIFFE hierarchy (trust domain -> server group -> node group -> server) and signs SVIDs. Reached via REST under `/api/swa` with header `Authorization: Token token="<token>"` and `Accept: application/x.secretsmgr.v2+json`. SWA's Terraform provider talks to this layer.
2. **SWA Server (in-cluster Deployment).** Authenticates to the control plane via JWT (projected SA token at `/var/run/secrets/tokens/swa-token`, audience `conjur`; the audience string is still `conjur` even though the SaaS product is "Secrets Manager"). Listens on `:8443` (gRPC/API for agents) and `:8080` (web). With `rbac.createTokenReviewRole=true`, gets the cluster-wide `TokenReview` permission required by the `k8s_psat` node attestor. Trust roots persisted at `/var/swa/certs`. To register a server, you POST `authentication.data` containing the cluster's OIDC `issuer` and either `jwks_uri` (tenant pulls) or inline `public_keys` (tenant validates locally; use this on a laptop, the tenant can't reach your kind API server).
3. **SWA Agent (in-cluster DaemonSet, or stand-alone on a VM).** Per-node. Attests workloads and exposes a SPIFFE Workload API socket at `/tmp/swa-agent/public/api.sock` (via `hostPath`) so co-located workload pods can fetch SVIDs. Requires `hostPID: true` (read `/proc` for workload attestation), `hostNetwork: true` (reach the kubelet API for the `k8s` workload attestor), and `dnsPolicy: ClusterFirstWithHostNet`. Runs as non-root uid/gid `65532`; an init container fixes socket-dir permissions.

**SPIFFE hierarchy** (created on the control plane before any in-cluster install):

```
trust domain (e.g., mac.local)
  └── server group (one or more, scoped to a node attestor: k8s_psat or x509pop)
        └── node group (defines which workloads can get SVIDs; carries the swa_nodegroup label)
              └── server (registration creates an authn_id you pass to the chart as controlPlane.auth.loginURL)
```

**Node attestation** uses one of:
- `k8s_psat` (default) -- a projected SA token with audience `swa-server` mounted at `/var/run/secrets/swa/serviceaccount/token`. This is separate from the default SA token, which the workload attestor uses for kubelet API access.
- `x509pop` -- agent presents an X.509 cert/key from `nodeAttestor.x509pop.certSecret`, or from inline `cert`/`key` values (the chart will render a secret). VM/Ansible deploys default to this; the agent's certificate Subject CN **must equal the node group name** exactly.

The agent's `podLabels.swa_nodegroup` is referenced by the server's SPIFFE ID template; preserve any `podLabels` already set when editing the agent's values, and make sure the value matches the node group name from the control plane.

## Platform notes

- **macOS (Apple Silicon):** use the `*-arm64v8` image tarballs. `make kind-load-images` loads both architectures into the kind node; only the arm64 ones run. Full step-by-step is in [`docs/under-the-hood.md`](docs/under-the-hood.md).
- **EKS:** set `setNodeNameEnv: false` on the agent. Instance-ID node names don't resolve via DNS; with `hostNetwork: true` the agent falls back to `127.0.0.1` to reach the kubelet.
- **OpenShift:** use `push-openshift-images` (logs into the internal registry with the `oc` token) rather than `push-images`. Provide `OS_PROJECT` if not using the default `swa`.
- **Windows:** the bash installer refuses MINGW/MSYS/CYGWIN; use `install-terraform-provider.ps1`.

## Refetching docs

The `swa-docs/` mirror was built from the upstream MadCap Flare SPA via Playwright (the page is JS-rendered; `curl` / WebFetch get a 404 SPA shell). To refresh a single page, navigate Playwright to its `source:` URL, capture `#mc-main-content`'s `outerHTML`, then run the conversion pipeline:

```bash
python3 -c '
import json, re
from pathlib import Path
from bs4 import BeautifulSoup
from markdownify import markdownify
# (see git history of swa-docs for the AdmonNote / AdmonCode preprocessing)
'
```

Alternatively, a local markitdown install (e.g., `pip install markitdown`) gives a quick conversion without the MadCap-specific cleanup; it works but leaves "Copy to clipboard" UI text and 2-column callout tables in the output.
