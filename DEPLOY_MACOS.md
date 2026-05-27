# Deploy Secure Workload Access (SWA) on a Macbook

This guide walks you from a clean Apple Silicon Macbook to a running SWA Server + SWA Agent. It uses the artifacts shipped in `swa-release-1.0.4/` (which is gitignored — treat it as a vendor drop) and the official docs mirrored under [`swa-docs/`](swa-docs/INDEX.md).

> **What "deploy on a Macbook" actually means.** SWA Server runs on **Kubernetes**, and the issuing/signing side of SWA depends on a **CyberArk Secrets Manager – SaaS tenant** (the "control plane"). You can run the Mac-side pieces — a local Kubernetes cluster (kind), the Helm charts, the Terraform provider, and the agent binary — entirely on your laptop, but for SWA to actually issue identities end-to-end you need a tenant URL and an admin access token. This guide covers both **Path A: local sandbox** (just exercise the bundle, no tenant) and **Path B: full deploy** (with a real tenant).

---

## 0. Confirmed environment

This guide is written for, and was sanity-checked against, the following on this machine:

| Component | Version |
|---|---|
| macOS | 26.5 (Apple Silicon, `arm64`) |
| Docker Desktop | 29.5.2 |
| kind | v0.27.0 |
| kubectl | v1.34.1 |
| Helm | v3.19.0 |
| Terraform | v1.5.7 |
| Bundle | `swa-release-1.0.4/` (manifest: `swa-services main/758-0d54f57b`, `swa-customer-components main/71-e0de5733`) |

The bundle ships images for **both** `amd64` and `arm64v8`. On Apple Silicon you only need the `arm64v8` variants — `swa-agent:0.0.0-SNAPSHOT-arm64v8` and `swa-server:0.0.0-SNAPSHOT-arm64v8`.

## 1. Prerequisites

Install the tools (skip what you already have):

```bash
brew install --cask docker            # Docker Desktop, or use OrbStack
brew install kind kubectl helm terraform
```

Make sure Docker Desktop (or OrbStack) is running before any `kind` or `helm` command:

```bash
docker version --format '{{.Server.Version}}'   # should print, e.g., 29.5.2
```

> **Note.** The SWA Server chart targets Kubernetes **v1.33–1.35**. Use a `kindest/node` image in that range. The version examples below pin `v1.34.0`.

For Path B (full deploy) you additionally need:

- A CyberArk Secrets Manager – SaaS tenant with **Secure Workload Access** entitlement and the Secrets Manager **Admin** role.
- A bearer token (the docs call it `TOKEN`); the auth flow is documented at [docs.cyberark.com → Authenticate user](https://docs.cyberark.com/early-release/swa/en/content/developer/conjur_api_authenticate_user.htm).
- Your tenant subdomain. The SWA API base is `https://<subdomain>.secretsmgr.cyberark.cloud`.

---

## 2. Path A — Local sandbox in kind (no tenant)

Use this to verify that the bundle, charts, and Terraform provider are all sound on your machine. The SWA Server pod will start but will **fail to authenticate** to the (absent) control plane — that's expected and the point is the *installability* check.

### 2.1 Create a kind cluster

```bash
cd swa-release-1.0.4
kind create cluster --name swa --image kindest/node:v1.34.0
kubectl cluster-info --context kind-swa
```

### 2.2 Load the SWA images into kind

The Makefile target loads every `.tar` in `container-images/`:

```bash
make kind-load-images KIND_CLUSTER=swa
```

Both architectures load; only `arm64v8` will actually run on Apple Silicon. After this:

```bash
docker exec swa-control-plane crictl images | grep swa
# expect: docker.io/library/swa-agent:0.0.0-SNAPSHOT-arm64v8
#         docker.io/library/swa-server:0.0.0-SNAPSHOT-arm64v8
```

### 2.3 Install the SWA Server chart (sandbox)

The chart is packaged as `helm/swa-server-0.1.0.tgz`; `helm install` accepts the `.tgz` directly. Point `image.repository`/`image.tag` at the locally-loaded tag and supply placeholder control-plane settings:

```bash
helm install swa-server ./helm/swa-server-0.1.0.tgz \
  --namespace swa-system --create-namespace \
  --set image.repository=swa-server \
  --set image.tag=0.0.0-SNAPSHOT-arm64v8 \
  --set image.pullPolicy=IfNotPresent \
  --set controlPlane.url=https://sandbox.example.invalid \
  --set controlPlane.auth.loginURL=sandbox-authn \
  --set rbac.createTokenReviewRole=true \
  --set trustDomain.name=sandbox.local
```

```bash
kubectl -n swa-system get pods -w
```

Pod scheduling and image pull should succeed. The container's auth loop will fail against `sandbox.example.invalid` — read it as a positive signal that everything *up to* control-plane reachability works.

### 2.4 Install the SWA Agent chart (sandbox)

```bash
helm install swa-agent ./helm/swa-agent-0.1.0.tgz \
  --namespace swa-system \
  --set image.repository=swa-agent \
  --set image.tag=0.0.0-SNAPSHOT-arm64v8 \
  --set image.pullPolicy=IfNotPresent \
  --set trustDomain.name=sandbox.local \
  --set server.address=swa-server.swa-system.svc.cluster.local:8443 \
  --set nodeAttestor.type=k8s_psat \
  --set nodeAttestor.k8s_psat.cluster=kind-swa \
  --set podLabels.swa_nodegroup=sandbox-ng
```

```bash
kubectl -n swa-system get pods,daemonsets
```

### 2.5 Install the Terraform provider locally

This installs the provider into `~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/<version>/darwin_arm64/` so any local Terraform config can use it:

```bash
./install-terraform-provider.sh
# auto-detects darwin/arm64 and prints the required_providers block
```

Verify the binary landed:

```bash
ls ~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/*/darwin_arm64/
```

### 2.6 Tear down the sandbox

```bash
helm -n swa-system uninstall swa-agent swa-server
kind delete cluster --name swa
```

---

## 3. Path B — Full deploy against a Secrets Manager – SaaS tenant

This follows [Get started with SWA on Kubernetes](swa-docs/pages/ccl-swa-getstarted-k8.md) and [Install SWA on Kubernetes with Helm](swa-docs/pages/ccl-swa-install-helm.md), specialized for a kind cluster on your laptop.

### 3.1 Shell variables

Set once per shell — every command below uses these:

```bash
export TENANT_SUBDOMAIN="<your-subdomain>"
export SWA_API_BASE="https://${TENANT_SUBDOMAIN}.secretsmgr.cyberark.cloud"
export TOKEN="<bearer token from the authenticate flow>"
export TRUST_DOMAIN_NAME="mac.local"
export SERVER_GROUP_NAME="mac-sg"
export NODE_GROUP_NAME="mac-ng"
export SERVER_NAME="swa-server-mac"
```

The `Authorization` header is `Token token="${TOKEN}"` (note the literal `token="..."` form — not a plain `Bearer`). The `Accept` header must be `application/x.secretsmgr.v2+json`.

### 3.2 Create the SPIFFE hierarchy

```bash
# 1. Trust domain
curl -sS -X POST "${SWA_API_BASE}/api/swa/trust-domains" \
  -H "Authorization: Token token=\"${TOKEN}\"" \
  -H "Accept: application/x.secretsmgr.v2+json" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${TRUST_DOMAIN_NAME}\"}"

# 2. Server group — accepts agents whose pods carry the swa_nodegroup label
curl -sS -X POST "${SWA_API_BASE}/api/swa/trust-domains/${TRUST_DOMAIN_NAME}/server-groups" \
  -H "Authorization: Token token=\"${TOKEN}\"" \
  -H "Accept: application/x.secretsmgr.v2+json" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"${SERVER_GROUP_NAME}\",
    \"description\": \"Macbook kind cluster\",
    \"node_attestation\": {
      \"k8s_psat\": {
        \"clusters\": {
          \"kind-swa\": {
            \"service_account_allow_list\": [\"swa-system:swa-agent\"],
            \"audience\": [\"swa-server\"],
            \"allowed_pod_label_keys\": [\"swa_nodegroup\"]
          }
        }
      }
    }
  }"

# 3. Node group
curl -sS -X POST "${SWA_API_BASE}/api/swa/trust-domains/${TRUST_DOMAIN_NAME}/server-groups/${SERVER_GROUP_NAME}/node-groups" \
  -H "Authorization: Token token=\"${TOKEN}\"" \
  -H "Accept: application/x.secretsmgr.v2+json" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${NODE_GROUP_NAME}\",\"workload_type\":\"kubernetes\"}"
```

### 3.3 Discover the kind cluster's OIDC config (used to register the server)

```bash
kind create cluster --name swa --image kindest/node:v1.34.0
cd swa-release-1.0.4 && make kind-load-images KIND_CLUSTER=swa
kubectl get --raw '/.well-known/openid-configuration' | jq .
```

Save the `issuer` and `jwks_uri` values.

> **Most laptop tenants cannot reach the kind API server's JWKS URL.** Your tenant is in the cloud; your kind cluster is on your Mac. Use the **`public_keys` registration path** instead of `jwks_uri` so the tenant validates locally-cached keys rather than calling back to your laptop. Fetch the JWKS contents inline:
>
> ```bash
> ISSUER=$(kubectl get --raw '/.well-known/openid-configuration' | jq -r .issuer)
> JWKS=$(kubectl get --raw '/openid/v1/jwks')
> ```

### 3.4 Register the SWA Server

```bash
curl -sS -X POST "${SWA_API_BASE}/api/swa/trust-domains/${TRUST_DOMAIN_NAME}/server-groups/${SERVER_GROUP_NAME}/servers" \
  -H "Authorization: Token token=\"${TOKEN}\"" \
  -H "Accept: application/x.secretsmgr.v2+json" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"${SERVER_NAME}\",
    \"authentication\": {
      \"type\": \"jwt\",
      \"data\": {
        \"issuer\": \"${ISSUER}\",
        \"public_keys\": ${JWKS}
      }
    }
  }"
```

Capture the `authn_id` from the response — you need it in the next step:

```bash
export AUTHN_ID="<authn_id from above>"
```

### 3.5 Install the SWA Server chart against the real tenant

```bash
helm install swa-server ./helm/swa-server-0.1.0.tgz \
  --namespace swa-system --create-namespace \
  --set image.repository=swa-server \
  --set image.tag=0.0.0-SNAPSHOT-arm64v8 \
  --set image.pullPolicy=IfNotPresent \
  --set controlPlane.url="${SWA_API_BASE}" \
  --set controlPlane.auth.loginURL="${AUTHN_ID}" \
  --set rbac.createTokenReviewRole=true \
  --set trustDomain.name="${TRUST_DOMAIN_NAME}"
```

Watch it converge:

```bash
kubectl -n swa-system get pods -w
kubectl -n swa-system logs deploy/swa-server -f
```

A healthy server logs successful authentication against the control plane and exposes `:8443` for agents and `:8080` for the web interface.

### 3.6 Install the SWA Agent

```bash
helm install swa-agent ./helm/swa-agent-0.1.0.tgz \
  --namespace swa-system \
  --set image.repository=swa-agent \
  --set image.tag=0.0.0-SNAPSHOT-arm64v8 \
  --set image.pullPolicy=IfNotPresent \
  --set trustDomain.name="${TRUST_DOMAIN_NAME}" \
  --set server.address=swa-server.swa-system.svc.cluster.local:8443 \
  --set nodeAttestor.type=k8s_psat \
  --set nodeAttestor.k8s_psat.cluster=kind-swa \
  --set podLabels.swa_nodegroup="${NODE_GROUP_NAME}"
```

The `podLabels.swa_nodegroup` value **must** match the `NODE_GROUP_NAME` — the SPIFFE ID template on the server is what stitches them together. See [Design and assign SWA node groups](swa-docs/pages/ccl-swa-node-groups-design.md).

---

## 4. Verify a workload can fetch an SVID

Deploy a throwaway pod that mounts the agent's Workload API socket and asks for a JWT-SVID:

```bash
kubectl -n swa-system run svid-probe --rm -it --restart=Never \
  --image=alpine:3.20 \
  --overrides='{"spec":{"volumes":[{"name":"sock","hostPath":{"path":"/tmp/swa-agent"}}],"containers":[{"name":"svid-probe","image":"alpine:3.20","command":["sh","-c","apk add --no-cache curl && ls -la /sock/public/api.sock && sleep 30"],"volumeMounts":[{"name":"sock","mountPath":"/sock"}]}]}}'
```

If `api.sock` exists and is owned by `65532:65532`, the agent is healthy. The actual SVID-fetch wire format is a gRPC call against the SPIFFE Workload API — the bundled `swa-agent` binary under `binaries/` includes a client subcommand you can copy in and invoke (see [Install an SWA agent on a machine](swa-docs/pages/ccl-swa-install-agent-machine.md) for the `swa-agent api fetch jwt --audience ... --socketPath ...` syntax).

---

## 5. Observability and troubleshooting

| Symptom | First place to look |
|---|---|
| Server pod CrashLoopBackOff | `kubectl -n swa-system logs deploy/swa-server` — usually `controlPlane.url` typo, missing `authn_id`, or `RBAC` missing `TokenReview` |
| Agent pod stuck `Init` | Init container fixes `/tmp/swa-agent` permissions to `65532:65532`; check kind node has `hostPath` enabled (default) |
| Agent runs but never attests | Server's `service_account_allow_list` / `cluster` mismatch — re-check the values you posted in §3.2 |
| `k8s` workload attestor 403 from kubelet | See the [Troubleshoot SWA](swa-docs/pages/ccl-swa-troubleshooting.md) page; kind sometimes serves kubelet over a self-signed cert |

Useful one-liners:

```bash
kubectl -n swa-system logs ds/swa-agent --tail=200
kubectl -n swa-system get events --sort-by=.lastTimestamp | tail -20
kubectl -n swa-system describe pod -l app.kubernetes.io/name=swa-server
```

---

## 6. Cleanup

```bash
helm -n swa-system uninstall swa-agent swa-server || true
kubectl delete ns swa-system --wait=false
kind delete cluster --name swa
```

Tenant-side, delete in reverse order (server → node group → server group → trust domain):

```bash
curl -sS -X DELETE "${SWA_API_BASE}/api/swa/trust-domains/${TRUST_DOMAIN_NAME}/server-groups/${SERVER_GROUP_NAME}/servers/${SERVER_NAME}" \
  -H "Authorization: Token token=\"${TOKEN}\"" -H "Accept: application/x.secretsmgr.v2+json"
# repeat for node-groups, server-groups, trust-domains
```

---

## 7. Mac-specific gotchas

- **Arch:** Apple Silicon must use `*-arm64v8` images. If you accidentally pin `image.tag=0.0.0-SNAPSHOT-amd64`, pods loop with `exec format error` after Docker emulation gives up.
- **Docker Desktop vs. OrbStack:** Both work with kind; OrbStack uses less RAM. If you switch, recreate the cluster (kind state is per-Docker-runtime).
- **`hostNetwork: true` on kind:** The agent chart uses `hostNetwork` so it can reach the kubelet API. On kind that "host" is the kind-node container, not your Mac — this is fine and is what the chart expects.
- **Tenant reachability:** Your kind cluster cannot expose anything to your tenant. Always use `public_keys` for SWA Server registration on a laptop (§3.3), never `jwks_uri`.
- **SNAPSHOT builds:** The `0.0.0-SNAPSHOT` images in this bundle are pre-release. Don't rely on them for compatibility guarantees; they're for local validation of the install path.
