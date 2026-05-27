# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Implementation methodology — agent teams with builder/validator pairs

All non-trivial implementation work in this repo is built by **Claude Code agent teams** (https://code.claude.com/docs/en/agent-teams) — *not* by a single session and *not* by ad-hoc subagents. The feature is enabled (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in `~/.claude/settings.json`; Claude Code is v2.1.152+).

**Per-milestone team shape.** Each milestone in `docs/superpowers/plans/` is implemented by a **builder–validator pair** spawned as agent teammates (see spec §13 in `docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md`):

- **Lead** — the active Claude Code session. Spawns the team, assigns tasks, synthesizes results, decides when to advance to the next milestone.
- **`builder-M{n}`** — `general-purpose` agent type, full tool access. Executes the milestone's plan task-by-task. Marks tasks completed in the shared task list and DMs the validator when done.
- **`validator-M{n}`** — `general-purpose` agent type, spawned with `mode: "bypassPermissions"` so its verification commands (kubectl, terraform plan/show, make smoke, curl against tenant) don't pile up prompts on the lead. The validator's read-only discipline is enforced via the prompt ("you describe bugs in revision tasks, you do NOT fix them"), not by plan-mode gating — the trade was made on 2026-05-27 because per-command prompts dominated wall time during M1. Grades against spec §13.4 (10 criteria, PASS ≥9). Below threshold: creates revision tasks back to the builder; hard cap 3 cycles.

Builder and validator shut down after each milestone passes (`Ask <name> to shut down`); the next milestone spawns a fresh pair. This bounds context bleed and token cost.

**Scale out by adding teammates, not by stuffing one agent.** When a task naturally splits across independent surfaces (e.g., backend service + IaC + frontend), spawn a teammate per surface and let them coordinate through the shared task list. The Anthropic guidance is 3–5 teammates as a starting point, 5–6 tasks per teammate; scale up only when work genuinely parallelizes. Each teammate is a full Claude session — costs scale linearly. See [[agent-teams-builder-validator]] in the PANW vault for the canonical write-up of this pattern.

**Cleanup is the lead's job.** When all milestones are validated, the lead shuts down any remaining teammates then runs `Clean up the team` — teammates must not run cleanup themselves (per agent-teams docs).

**This is the default for all future work, not just this repo.** If you're tempted to do a multi-file implementation as a single session, stop and spawn a team instead.

## Repository nature

This repo is a sandbox for working with the **CyberArk Secure Workload Access (SWA)** release distribution — not a source-code project. The tracked content is documentation and a Mac deploy guide; the actual release contents live under `swa-release-1.0.4/`, which is **gitignored**. Treat `swa-release-1.0.4/` as a vendor-provided artifact: read it, extract from it, run its scripts, but don't `git add` inside it without also intending to change `.gitignore`.

There is no application code to build, lint, or test here. The commands below are operational — loading container images, installing charts, installing a Terraform provider.

## Where the knowledge lives

- **[`DEPLOY_MACOS.md`](DEPLOY_MACOS.md)** — runnable end-to-end Mac walkthrough that ties the bundle artifacts to a kind cluster, with both a sandbox path (no tenant) and a full-deploy path (against a Secrets Manager – SaaS tenant). This is the right starting point for any "make SWA work on this laptop" request.
- **[`swa-docs/INDEX.md`](swa-docs/INDEX.md)** — local mirror of the upstream early-release docs (12 pages from `docs.cyberark.com/early-release/swa/.../conjurcloud/`). Each page in `swa-docs/pages/` keeps its upstream URL in its frontmatter under `source:`. Prefer reading these over re-fetching; if a question turns on something that might be newer than the mirror, refetch the page named in the frontmatter rather than guessing.
- **[`swa-docs/raw/`](swa-docs/raw/)** — original rendered HTML for each crawled page (JSON-encoded strings, captured via Playwright since the docs site is a JS-rendered MadCap Flare SPA). Keep for traceability; humans should read `pages/*.md`.

## What's in the release

`swa-release-1.0.4/` is a self-contained Kubernetes deployment package for SWA, a SPIFFE-style workload identity / attestation system. Layout:

- `container-images/*.tar` — pre-built `swa-server` and `swa-agent` images (amd64 + arm64v8) as `docker image load`-able tarballs, originally tagged `0.0.0-SNAPSHOT` with no repository prefix.
- `helm/swa-server-0.1.0.tgz`, `helm/swa-agent-0.1.0.tgz` — packaged Helm charts. Extract to read `values.yaml`.
- `terraform-provider/` — `cyberark/swa` Terraform provider binaries for darwin/linux/windows × amd64/arm64, plus `SHA256SUMS` + GPG `.sig`.
- `binaries/` — standalone `swa-agent` binaries (darwin/linux × amd64/arm64). No server binary — the agent is the only component meant to run outside Kubernetes.
- `install-terraform-provider.sh` / `.ps1` — install the provider into `~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/<version>/<os>_<arch>/`.
- `Makefile` — image push/load targets (default goal is `help`).
- `manifest.txt` — pins the upstream component versions (`swa-services`, `swa-customer-components`) for this release.

## Common operations

All commands run from `swa-release-1.0.4/`.

**Push images to a registry** — auto-loads each tar via `docker image load`, parses the loaded tag, retags to `$REGISTRY/<image>`, pushes:

```bash
make push-images REGISTRY=<registry-url>
# OpenShift: logs in via `oc whoami -t | docker login`, pushes under $REGISTRY/$OS_PROJECT
make push-openshift-images REGISTRY=<registry-url> OS_PROJECT=swa
# Local kind cluster (no registry needed)
make kind-load-images KIND_CLUSTER=<name>
```

`REGISTRY` defaults to `$(oc registry info)`. Don't pre-tag the tarballs — the Makefile rule does it.

**Install the Terraform provider** — auto-detects OS/arch, picks the newest matching dir under `terraform-provider/`, copies the binary into the local plugin dir, prints the `required_providers` block:

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

SWA splits into three layers. **You can't do a real end-to-end deploy with the bundle alone** — the control plane is a SaaS tenant the bundle has no copy of.

1. **Control plane (SaaS, not in this bundle).** A CyberArk **Secrets Manager – SaaS** tenant at `https://<subdomain>.secretsmgr.cyberark.cloud`. Holds the SPIFFE hierarchy (trust domain → server group → node group → server) and signs SVIDs. Reached via REST under `/api/swa` with header `Authorization: Token token="<token>"` and `Accept: application/x.secretsmgr.v2+json`. SWA's Terraform provider talks to this layer.
2. **SWA Server (in-cluster Deployment).** Authenticates to the control plane via JWT (projected SA token at `/var/run/secrets/tokens/swa-token`, audience `conjur` — yes, the audience string is still `conjur` even though the SaaS product is "Secrets Manager"). Listens on `:8443` (gRPC/API for agents) and `:8080` (web). With `rbac.createTokenReviewRole=true`, gets the cluster-wide `TokenReview` permission required by the `k8s_psat` node attestor. Trust roots persisted at `/var/swa/certs`. To register a server, you POST `authentication.data` containing the cluster's OIDC `issuer` and either `jwks_uri` (tenant pulls) or inline `public_keys` (tenant validates locally — use this on a laptop, the tenant can't reach your kind API server).
3. **SWA Agent (in-cluster DaemonSet, or stand-alone on a VM).** Per-node. Attests workloads and exposes a SPIFFE Workload API socket at `/tmp/swa-agent/public/api.sock` (via `hostPath`) so co-located workload pods can fetch SVIDs. Requires `hostPID: true` (read `/proc` for workload attestation), `hostNetwork: true` (reach the kubelet API for the `k8s` workload attestor), and `dnsPolicy: ClusterFirstWithHostNet`. Runs as non-root uid/gid `65532`; an init container fixes socket-dir permissions.

**SPIFFE hierarchy** (created on the control plane before any in-cluster install):

```
trust domain (e.g., mac.local)
  └── server group (one or more, scoped to a node attestor: k8s_psat or x509pop)
        └── node group (defines which workloads can get SVIDs; carries the swa_nodegroup label)
              └── server (registration creates an authn_id you pass to the chart as controlPlane.auth.loginURL)
```

**Node attestation** uses one of:
- `k8s_psat` (default) — a projected SA token with audience `swa-server` mounted at `/var/run/secrets/swa/serviceaccount/token`. This is separate from the default SA token, which the workload attestor uses for kubelet API access.
- `x509pop` — agent presents an X.509 cert/key from `nodeAttestor.x509pop.certSecret`, or from inline `cert`/`key` values (the chart will render a secret). VM/Ansible deploys default to this; the agent's certificate Subject CN **must equal the node group name** exactly.

The agent's `podLabels.swa_nodegroup` is referenced by the server's SPIFFE ID template — preserve any `podLabels` already set when editing the agent's values, and make sure the value matches the node group name from the control plane.

## Platform notes

- **macOS (Apple Silicon):** use the `*-arm64v8` image tarballs. `make kind-load-images` loads both architectures into the kind node; only the arm64 ones run. Full step-by-step is in [`DEPLOY_MACOS.md`](DEPLOY_MACOS.md).
- **EKS:** set `setNodeNameEnv: false` on the agent. Instance-ID node names don't resolve via DNS; with `hostNetwork: true` the agent falls back to `127.0.0.1` to reach the kubelet.
- **OpenShift:** use `push-openshift-images` (logs into the internal registry with the `oc` token) rather than `push-images`. Provide `OS_PROJECT` if not using the default `swa`.
- **Windows:** the bash installer refuses MINGW/MSYS/CYGWIN — use `install-terraform-provider.ps1`.

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

Use `/Users/joe.garcia/Library/Python/3.13/bin/markitdown` if you want a quick conversion without the MadCap-specific cleanup — it works but leaves "Copy to clipboard" UI text and 2-column callout tables in the output.
