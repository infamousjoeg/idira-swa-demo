# SWA documentation — local mirror

Local mirror of the CyberArk Secure Workload Access (SWA) early-release docs section, captured from <https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-getstarted-swa-lp.htm> and its linked pages. Source HTML lives in `raw/`; converted markdown is under `pages/`.

The mirror is a snapshot — the upstream is under active development. Each page's frontmatter has the original `source:` URL; use that when you need to confirm something is current.

## Reading order

If you've never touched SWA before, read in this order:

1. **[Secure workloads with SWA](pages/ccl-getstarted-swa-lp.md)** — landing page; lists every other doc.
2. **[Secure workload identities with SPIFFE and SWA](pages/ccl-swa-overview.md)** — concepts: SPIFFE IDs, SVIDs, trust domains, node + workload attestation. Read this before touching install steps.
3. **[Design and assign SWA node groups](pages/ccl-swa-node-groups-design.md)** — how the SPIFFE hierarchy (trust domain → server group → node group → workloads) maps to your environment. The `swa_nodegroup` label model is here.
4. **[SPIFFE templates, attestors, and registration policies for SWA](pages/ccl-swa-node-groups-templates-policies.md)** — reference for the SPIFFE ID template strings, the available attestors (`k8s_psat`, `x509pop`, `k8s`, `unix`), and workload registration policies.

## Deploy path (choose one)

| Goal | Read |
|---|---|
| Run the full server + agent on Kubernetes | [Get started with SWA on Kubernetes](pages/ccl-swa-getstarted-k8.md) → [Install SWA on Kubernetes with Helm](pages/ccl-swa-install-helm.md) |
| Manage SWA control-plane resources as code | [Install the SWA Terraform provider](pages/ccl-swa-terraform-provider.md) |
| Attest a bare-metal / VM workload outside k8s | [Install an SWA agent on a machine](pages/ccl-swa-install-agent-machine.md) |
| Things break | [Troubleshoot Secure Workload Access (SWA)](pages/ccl-swa-troubleshooting.md) |

## Integrations

- **[Configure OIDC issuer values for SWA integrations](pages/ccl-swa-oidc.md)** — the issuer / JWKS URL pair you give to external relying parties.
- **[Configure JWT requirements for SWA integrations](pages/ccl-swa-jwt.md)** — signing algorithms (RSA vs. EC) and TTLs supported per integration.
- **[Integrate SWA with Secrets Manager JWT authentication](pages/cjr-authn-jwt-swa.md)** — wire JWT-SVIDs into a Secrets Manager JWT authenticator so workloads can fetch secrets without static creds.

## What this mirror covers, and what it doesn't

It covers everything reachable in one hop from the SWA landing page. It does **not** include the API reference (`apis/ccl-api-swa-*.htm`) or the external-platform federation pages — links to those are preserved as absolute URLs in the converted markdown.

For Mac-specific deployment instructions that tie this docs content to the bundled `swa-release-1.0.4/` artifacts, see [`../DEPLOY_MACOS.md`](../DEPLOY_MACOS.md).
