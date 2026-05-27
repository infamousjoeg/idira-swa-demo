# Idira SWA Demo on a kind cluster — Design Spec

**Status:** Draft for validator review.
**Author:** Brainstorm session with Claude, 2026-05-27.
**Tenant:** CyberArk Secrets Manager – SaaS, subdomain `infamous`.
**Sub-brand:** Idira (PANW Identity Blue `#265BFF`).
**Spec location:** `docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md` (this file). Copy to `~/Documents/Projects/panw/plans/` once approved.

---

## 1. Overview

A self-contained demo that runs on a Macbook (Apple Silicon) and proves end-to-end Idira / Secure Workload Access (SWA) value: a believable internal application performs a real task, that task requires a secret from CyberArk Secrets Manager – SaaS, and the secret is fetched using a SPIFFE JWT-SVID issued by the in-cluster SWA agent — no static credentials anywhere in the workload.

The interface is a split-pane web UI: the left half is a fictional **Praetor Logistics** shipment-lookup portal (the consumer surface); the right half is a live **Idira inspector** that shows the SPIFFE plumbing — SPIFFE IDs, mTLS handshake, JWT-SVID issuance, Secrets Manager call — as the click flows through.

The demo runs against a real `infamous` SM SaaS tenant; the SPIFFE hierarchy and Secrets Manager objects are managed declaratively via the bundled `cyberark/swa` Terraform provider. Cluster lifecycle is disposable (`make up`, `make down`) so the whole environment can be torn down and rebuilt in roughly three minutes.

## 2. Goals

1. **Real end-to-end identity**: portal proves who it is to carrier via SPIFFE X.509-SVID mTLS; carrier proves who it is to Secrets Manager via JWT-SVID; secret never lives on disk or in env vars.
2. **Brand-grade UI**: the visual output is indistinguishable from a polished, human-designed Idira product surface. Zero markers of AI generation (no generic gradients, no emoji, no shadcn defaults, no "AI-stock" copy).
3. **Repeatable**: a single `make up` from a clean Macbook produces a healthy, demo-ready cluster registered with the real tenant. A single `make down` removes it.
4. **Disposable but credible**: TF-managed control-plane resources can be created and destroyed cleanly. The demo state on the tenant matches what a real customer would see, not a hand-rolled bespoke setup.
5. **Implementation discipline**: each milestone is built by a builder–validator agent-team pair gated at a 9/10 quality score before merge.

## 3. Non-goals

- A production-ready SWA reference architecture. SWA is `0.0.0-SNAPSHOT` in the bundle; this is a *demo* of the install path and value, not a hardened deployment.
- Multi-cluster federation. Single kind cluster.
- A polished installer for non-Apple-Silicon hardware. Linux amd64 / Windows are intentionally out of scope for the initial milestone.
- An authoritative Idira product UI. The visual treatment honors the PANW brand guide but does not require approval from PANW brand review for this demo.
- A real third-party carrier API. The "carrier lookup" returns canned JSON from a fixture; the *demonstration of secret-driven authentication* is real, the downstream call is mocked.

## 4. Constraints

| Source | Constraint |
|---|---|
| Bundle | `swa-release-1.0.4/` is gitignored vendor drop. Images tagged `0.0.0-SNAPSHOT-arm64v8` for Apple Silicon. TF provider `cyberark/swa` v `0.1.0-0d54f57b-758`. Server chart targets Kubernetes 1.33–1.35. |
| Tenant | `infamous.secretsmgr.cyberark.cloud`; `infamous.id.cyberark.cloud` for OAuth. Bearer tokens short-lived (≤15 min typical). Authn is via OAuth2 client credentials → Identity JWT → SM `/api/authn-oidc/cyberark/conjur/authenticate`. |
| Laptop | Tenant cannot reach kind's API server. Server registration must use inline `public_keys`, never `jwks_uri`. |
| Brand | Idira Identity Blue `#265BFF` primary; PANW Cyber Orange `#FA582D` reserved for accent/alert. Helvetica Neue for HTML body, TT Hoves for headlines (system fallbacks acceptable). Sentence case for headlines; ALL CAPS for CTAs. Line-only iconography, never filled. Linear gradients only. |
| Implementation methodology | Each milestone implemented by a builder–validator agent-team pair. No milestone merges below 9/10 on the rubric defined in §13. |

## 5. Architecture

### 5.1 System

```
┌──────────── CyberArk SaaS (infamous) ────────────┐
│                                                   │
│  Identity OAuth                  SM control plane │
│  /oauth2/platformtoken           /api/authn-oidc/ │
│                                  /api/swa/*       │
│                                  /api/secrets/*   │
│                                                   │
│  TF "cyberark/swa" provider drives the SWA       │
│  control-plane objects + JWT authn + secret      │
└────────────────────────┬──────────────────────────┘
                         │ CONJUR_AUTHN_TOKEN
                         │ (re-fetched per apply)
                         ▼
┌──── kind cluster · ns: swa-system ──────────────┐
│  swa-server (Deployment)  :8443                 │
│  swa-agent  (DaemonSet, hostPath socket)        │
│                                                  │
│  ── ns: swa-demo ──                              │
│  portal   spiffe://idira.demo/kind-ng/ns/swa-demo/sa/portal  │
│           :8080 (browser)  :8443 (mTLS client)  │
│  carrier  spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier │
│           :8443 (mTLS server)                    │
└──────────────────────────────────────────────────┘
```

### 5.2 Trust boundary

Only the SaaS tenant holds SPIFFE signing material. Every cluster-side identity derives from the swa-agent's local Workload API socket at `/tmp/swa-agent/public/api.sock`. The browser session has no credentials and never speaks to the tenant directly — it watches an SSE stream from `portal` that relays trace events. The portal does not have the SM access token; only `carrier` does, and only for the lifetime of one request.

### 5.3 Demo click sequence

1. User opens `http://localhost:8080` (via `kubectl port-forward svc/portal 8080:8080 -n swa-demo`), enters a shipment ID, clicks **RESOLVE SECRET**.
2. **Portal → Carrier mTLS**: portal opens an mTLS connection to `carrier:8443`. Both sides validate peer SPIFFE IDs against the trust bundle. Inspector emits `mtls.peer_verified spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier`.
3. **Carrier acquires JWT-SVID**: carrier asks the local Workload API for a JWT-SVID with `aud=conjur` (the audience must match the SM JWT authenticator's `audience` variable, which in turn must match the SWA Server chart's `controlPlane.auth.audience` — `conjur` is the chart default). Inspector emits `jwt_svid.issued aud=conjur exp=…`.
4. **Carrier → SM authn-jwt**: carrier POSTs the JWT-SVID to `https://infamous.secretsmgr.cyberark.cloud/api/authn-jwt/secureWorkloadAccess/conjur/authenticate` (the authenticator service-id is `secureWorkloadAccess` per `swa-docs/pages/cjr-authn-jwt-swa.md`). SM validates the JWT against the in-tenant JWT authenticator, which trusts SWA's per-trust-domain JWKS at `…/api/swa/trust-domains/idira.demo/.well-known/jwks` and pulls the workload's SPIFFE ID from the JWT's `sub` claim. Returns a short-lived SM access token. Inspector emits `sm.authn_jwt ok`.
5. **Carrier fetches secret**: carrier GETs `/api/secrets/conjur/variable/swa-demo%2Fcarrier%2Fapi-key` with the SM access token. Inspector emits `sm.secret_fetched bytes=…`.
6. **Carrier looks up shipment**: uses the secret as the (mocked) carrier API key, returns canned JSON for the shipment ID from a fixture file. Inspector emits `carrier.lookup ok shipment=SHP-…`.
7. **Portal renders result** in the left pane; inspector trace remains visible in the right pane with full timing per hop.

## 6. Authentication

### 6.1 Two-hop helper (Service User + Conceal, no plaintext secrets on disk)

`scripts/get-sm-token.sh` reads `CLIENT_ID` and `CLIENT_SECRET` from its env (injected by `summon -p conceal_summon`, not from `.envrc`) and emits the SM operator token. Three steps:

1. Discover the per-tenant Identity URL via Platform Discovery (the `<subdomain>.id.cyberark.cloud` pattern is wrong — Identity URLs use a tenant ID like `ack4386.id.cyberark.cloud`).
2. Mint an Identity JWT via Service User `client_credentials` against `/Oauth2/Token/__idaptive_cybr_user_oidc` (HTTP Basic auth, form body `grant_type=client_credentials&scope=api`). The endpoint name and casing are load-bearing — `/oauth2/platformtoken` does NOT exist.
3. Exchange that JWT at SM's `/api/authn-oidc/cyberark/conjur/authenticate` with `Accept-Encoding: base64` to get the operator token.

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${PANW_SM_TENANT:?set in .envrc}"
: "${CLIENT_ID:?inject via summon -p conceal_summon}"
: "${CLIENT_SECRET:?inject via summon -p conceal_summon}"

# Step 1 — discover Identity URL (Identity tenant ID, not subdomain).
identity_url=$(curl -fsSL \
  "https://platform-discovery.cyberark.cloud/api/v2/services/subdomain/${PANW_SM_TENANT}" \
  | jq -er '.identity_administration.api')

# Step 2 — Service User token mint. Endpoint is `/Oauth2/Token/<app_id>`
# (camelCase, with app_id segment). `__idaptive_cybr_user_oidc` is the
# cross-tenant default Service User OAuth client; verified present on `infamous`.
identity_jwt=$(curl -fsSL -X POST \
  "${identity_url}/Oauth2/Token/__idaptive_cybr_user_oidc" \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "scope=api" \
  | jq -er .access_token)

# Step 3 — Exchange at SM for the operator token.
curl -fsSL -X POST \
  "https://${PANW_SM_TENANT}.secretsmgr.cyberark.cloud/api/authn-oidc/cyberark/conjur/authenticate" \
  -H 'Accept-Encoding: base64' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "id_token=${identity_jwt}"
```

Invocation pattern (all tenant-touching Make targets follow this shape):

```bash
summon -p conceal_summon --yaml '
CLIENT_ID:     !var infamousdev/claudecode/client_id
CLIENT_SECRET: !var infamousdev/claudecode/client_secret
' -- ./scripts/get-sm-token.sh
```

The `Accept-Encoding: base64` header on the SM call asks SM to return the access token **already base64-encoded** as `text/plain`. The script's stdout is that base64 string with no decoding — exactly the value the TF provider expects in `CONJUR_AUTHN_TOKEN` (and the value the `Authorization: Token token="<base64>"` header in §5.1 uses verbatim). No further encode/decode by the caller. Pair with `export CONJUR_APPLIANCE_URL=https://${PANW_SM_TENANT}.secretsmgr.cyberark.cloud`.

> **Why Conceal, not `.envrc`:** the operator's CyberArk Service User credentials are already stored in macOS Keychain via Conceal (paths `infamousdev/claudecode/client_id` and `infamousdev/claudecode/client_secret` — see `~/Documents/Projects/panw/memory/cyberark-tenant.md`). Plaintext in `.envrc` would re-duplicate them on disk for no benefit. Conceal + `summon` exports the values only into the spawned subprocess's env, never to disk and never visible to `ps`.

### 6.2 Token TTL handling

The helper is re-invoked (under `summon`) from every Make target that touches the tenant (`make tf-apply-platform`, `make tf-apply-app`, `make down`'s `terraform destroy` step, plus the smoketest's tenant-side checks). No long-lived caching. If the operator runs TF manually, they `eval "$(make tf-token)"` to re-export fresh values into the current shell — that target itself wraps in `summon`.

### 6.3 Carrier service auth (in-cluster, runtime)

The `carrier` Go service authenticates to SM using its **JWT-SVID** — not the OAuth client. The flow is:

1. Carrier calls `WorkloadAPIClient.FetchJWTSVID(ctx, &jwtsvid.Params{Audience: "conjur"})` (go-spiffe v2). The audience `conjur` is the chart default for `controlPlane.auth.audience` on the SWA Server and the value the JWT authenticator expects per `swa-docs/pages/cjr-authn-jwt-swa.md`.
2. POSTs that JWT to `/api/authn-jwt/secureWorkloadAccess/conjur/authenticate` on the tenant. The authenticator service-id is `secureWorkloadAccess`.
3. Receives base64 SM access token; uses it on `/api/secrets/conjur/variable/...`.

The JWT authenticator (`authn-jwt/secureWorkloadAccess`) is configured in §7 via TF with these variables (from the docs page above):

| Variable | Value |
|---|---|
| `jwks-uri` | `https://infamous.secretsmgr.cyberark.cloud/api/swa/trust-domains/idira.demo/.well-known/jwks` — SWA publishes a per-trust-domain JWKS. This is **not** kind's JWKS (that is only used for SWA Server PSAT registration in §7.3). |
| `issuer`   | `https://infamous.secretsmgr.cyberark.cloud/api/swa/trust-domains/idira.demo` |
| `token-app-property` | `sub` — the JWT-SVID carries the workload's SPIFFE ID in the standard `sub` claim. `sub` is the *claim selector*; the value of that claim is the SPIFFE ID. |
| `identity-path` | `data/swa/trust-domains/idira.demo/workloads` — branch under which SWA registers workload identities. |
| `audience` | `conjur` — matches step 1's audience. |

The SM policy in §7 restricts the carrier's SPIFFE ID (`spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier`) to reading the one secret.

> **JWT-SVID must be RSA-signed.** The agent chart defaults `agent.key.type` and `workload.key.type` to `ECP256`. The SM JWT authenticator does not accept EC-signed JWTs. Override both to an RSA variant (`RSA2048`) in `swa-agent.values.yaml` — see §8.2. The exact enum string is verified against the agent binary's accepted values in M1; if `RSA2048` is rejected, the next candidates to try are `rsa-2048` then `RSA-2048`.

## 7. Terraform module

### 7.1 Layout

```
platform/terraform/
├── main.tf              # required_providers: cyberark/swa (bundled, SPIFFE platform layer only)
│                        #                  AND cyberark/conjur (from public registry, Conjur policy/variables/authn-jwt)
├── variables.tf         # trust_domain (default "idira.demo"), server_group (default "kind-sg"),
│                        # node_group (default "kind-ng" — must match podLabels.swa_nodegroup in agent values),
│                        # server_name (default "swa-server-kind"), kind_cluster (default "kind-swa"),
│                        # sm_secret_id (default "swa-demo/carrier/api-key")
├── 10-spiffe.tf         # swa_trust_domain, swa_server_group (k8s_psat), swa_node_group   [cyberark/swa]
├── 20-server.tf         # swa_server with inline public_keys from data.external.kind_oidc [cyberark/swa]
├── 30-jwt-authn.tf      # Conjur authn-jwt service-id "secureWorkloadAccess" + its five
│                        #   policy vars from §6.3 (jwks-uri, issuer, token-app-property=sub,
│                        #   identity-path, audience)                                       [cyberark/conjur]
├── 40-policy.tf         # Conjur policy: host scoped to the carrier's SPIFFE ID;
│                        #   consumer of authn-jwt/secureWorkloadAccess; read on one var    [cyberark/conjur]
├── 50-secret.tf         # conjur_secret/conjur_variable "swa-demo/carrier/api-key"         [cyberark/conjur]
└── outputs.tf           # authn_id (for helm), carrier_host_id, secret_id
```

> **Why two providers (amended 2026-05-27):** the bundled `cyberark/swa` provider only ships SPIFFE-platform resources (`swa_trust_domain`, `swa_server_group`, `swa_node_group`, `swa_server` — verified via `terraform providers schema -json`). It does **not** ship a JWT-authenticator, policy, or variable resource (closing spec §16 OQ #3). Conjur policy / variables / authenticators are managed via the separate `cyberark/conjur` Terraform provider from the public registry. This is the canonical preference per Joe's `~/Documents/Projects/panw/memory/cyberark-tenant.md` ("For Conjur Cloud (Secrets Manager SaaS): prefer Terraform `cyberark/conjur` provider; fall back to `conjur` CLI; never `ark` for SM"). Both providers authenticate with the same `CONJUR_APPLIANCE_URL` + `CONJUR_AUTHN_TOKEN` env vars (verify on first `terraform init` for the conjur provider — adjust if wrong).

### 7.2 Two-apply pattern

Files `10-` and `20-` apply *before* the helm install — they create the trust domain, server group, node group, and register the server (capturing `authn_id` for the helm chart). Files `30-`, `40-`, `50-` apply *after* the cluster is up and the carrier service has been deployed (so the JWT authn configuration can reference the carrier's actual SPIFFE ID and the OIDC discovery URL). The Makefile orchestrates this.

Trade-off considered and rejected: single-apply with `depends_on` and dynamic discovery. The two-apply path is plainer to read, lets us run `terraform destroy` on each subset independently, and avoids a chicken-and-egg between TF and helm.

### 7.3 Laptop-tenant fix

`20-server.tf` uses `data "external" "kind_oidc"` to call a tiny script that returns the kind cluster's `issuer` and `public_keys` (the JWKS contents, not the URI):

```hcl
data "external" "kind_oidc" {
  program = ["bash", "${path.module}/../../scripts/kind-oidc.sh"]
}

resource "swa_server" "kind" {
  trust_domain    = swa_trust_domain.idira.name
  server_group    = swa_server_group.kind_sg.name
  name            = var.server_name
  authentication  = {
    type = "jwt"
    data = {
      issuer      = data.external.kind_oidc.result.issuer
      public_keys = data.external.kind_oidc.result.public_keys
    }
  }
}
```

`scripts/kind-oidc.sh` returns `{"issuer": "...", "public_keys": "<raw JWKS json>"}` from `kubectl get --raw /.well-known/openid-configuration` and `/openid/v1/jwks`.

### 7.4 Verification

`terraform output -json` after each apply must include `authn_id` (for apply #1) and `carrier_secret_id` (for apply #2). A failure to produce these is a hard fail before helm/app deploy proceeds.

> **Open question — to verify in M1**: the exact resource names in the bundled provider (`swa_trust_domain`, `swa_server_group`, `swa_node_group`, `swa_server`, plus whatever the JWT authn / policy / variable resources are called). The bundle does **not** ship a `docs/` directory alongside the provider binary (verified). The builder's first task in M1 is to discover the schema using one of: (a) install the provider, write an empty `provider "swa" {}` block, run `terraform providers schema -json`; (b) `strings ./terraform-provider-swa_* | grep -E '^swa_[a-z_]+$'` to enumerate registered resource types; (c) cross-reference against the upstream SWA Helm chart's CRD / RBAC fixtures if the provider's source is published. The shape stands either way.

## 8. SWA in-cluster install

### 8.1 Cluster prep

```bash
kind create cluster --name swa --image kindest/node:v1.34.0
cd swa-release-1.0.4 && make kind-load-images KIND_CLUSTER=swa
./install-terraform-provider.sh   # darwin/arm64
# If macOS gatekeeper complains, follow the brand-doc-blessed remediation:
xattr -d com.apple.quarantine ~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/*/darwin_arm64/terraform-provider-swa_*
```

### 8.2 Helm install (from `platform/helm/`)

`platform/helm/swa-server.values.yaml` and `swa-agent.values.yaml` capture the values declaratively (no `--set` sprawl). Templated via `envsubst` from the Makefile so `controlPlane.auth.loginURL` reads the TF output:

```yaml
# swa-server.values.yaml (excerpt)
image:
  repository: swa-server
  tag: 0.0.0-SNAPSHOT-arm64v8
  pullPolicy: IfNotPresent
controlPlane:
  url: ${PANW_SM_URL}                 # https://infamous.secretsmgr.cyberark.cloud
  auth:
    loginURL: ${SWA_AUTHN_ID}         # tf output
    audience: conjur                  # chart default, set explicitly so it stays in sync with §6.3
rbac:
  createTokenReviewRole: true
# Note: server chart has NO `trustDomain.name` key (verified against
# swa-release-1.0.4/helm/swa-server-0.1.0.tgz). The trust-domain identity lives
# on the control plane and on the agent. Upstream Helm doc lists it as a server
# parameter — that doc is inaccurate for the bundled chart.
```

```yaml
# swa-agent.values.yaml (excerpt)
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
# CRITICAL: override the chart defaults (ECP256) — SM JWT authenticator rejects
# EC-signed JWTs. See §6.3 RSA note.
agent:
  key:
    type: RSA2048
workload:
  key:
    type: RSA2048
podLabels:
  swa_nodegroup: kind-ng
```

### 8.3 Node attestation wiring (k8s_psat)

The server-group's `service_account_allow_list` declares `swa-system:swa-agent`. The agent mounts a projected service-account token with audience `swa-server` at `/var/run/secrets/swa/serviceaccount/token` (chart default). The server's pod has `rbac.createTokenReviewRole=true` so it can validate the token via the Kubernetes TokenReview API.

For workloads (portal, carrier), the agent uses the `k8s` workload attestor (chart default). The two services run with distinct ServiceAccounts (`portal` and `carrier`) in the `swa-demo` namespace. The SPIFFE ID template is **configured on the node group** in TF (`10-spiffe.tf`) as `spiffe://idira.demo/kind-ng/ns/{{.NamespaceName}}/sa/{{.ServiceAccountName}}` — note the `kind-ng` segment is the node-group name and is part of the workload identity by design (per `swa-docs/pages/ccl-swa-node-groups-design.md`). The agent's own identity (separate from workload identity) embeds the node group as well, per the system-managed agent template. No explicit per-workload registration is required beyond the node group's `swa_nodegroup` pod label matching the configured node-group name.

### 8.4 Cleanup

`make down` runs:
1. `helm -n swa-system uninstall swa-agent swa-server` (best-effort).
2. `kubectl delete ns swa-system swa-demo --wait=false`.
3. `kind delete cluster --name swa`.
4. `terraform -chdir=platform/terraform destroy -auto-approve` (with fresh `CONJUR_AUTHN_TOKEN`).

## 9. Application services

Both services are Go ~1.23, single-binary, multi-stage Docker build (`FROM gcr.io/distroless/static-debian12`). Both use `github.com/spiffe/go-spiffe/v2` for SVID handling.

### 9.1 `carrier`

Files under `apps/carrier/`:

```
apps/carrier/
├── main.go               # bootstraps Workload API client, mTLS server, trace channel
├── handler.go            # /lookup/{id} → fetch JWT-SVID, exchange at SM, fetch secret, lookup
├── sm_client.go          # tiny SM client: authn-jwt, fetch secret
├── fixture/shipments.json# canned shipment data keyed by id
├── trace.go              # internal trace bus (in-memory channel), emits to SSE
├── Dockerfile
└── README.md
```

Responsibilities:
- Boot: connect to `/tmp/swa-agent/public/api.sock` via `workloadapi.NewClient`. Bail loudly if the socket isn't there or auth fails.
- Serve mTLS server on `:8443` using `tlsconfig.MTLSServerConfig(svid, bundle, tlsconfig.AuthorizeMemberOf(idira.demo))`.
- Serve trace SSE on `:8444/trace` (over localhost only, no mTLS — read by the `portal` sidecar pattern? **No** — see §9.4 for how portal subscribes).
- On `/lookup/{id}`:
  1. Emit `request.received id={id}`.
  2. `FetchJWTSVID(ctx, audience="conjur")` — emit `jwt_svid.issued`. (Audience matches the JWT authenticator's `audience` variable from §6.3.)
  3. POST JWT to `${PANW_SM_URL}/api/authn-jwt/secureWorkloadAccess/conjur/authenticate` — emit `sm.authn_jwt {ok|err}`.
  4. GET `${PANW_SM_URL}/api/secrets/conjur/variable/swa-demo%2Fcarrier%2Fapi-key` with `Authorization: Token token="<sm-token>"` — emit `sm.secret_fetched`.
  5. Look up shipment in fixture; if not found, return 404. Emit `carrier.lookup {ok|miss}`.
  6. Return `{shipment_id, origin, dest, eta, carrier_name}`.

### 9.2 `portal`

Files under `apps/portal/`:

```
apps/portal/
├── main.go               # bootstrap, serve UI on :8080, mTLS client to carrier
├── ui/                   # frontend bundle (see §10)
│   ├── index.html        # split-view shell
│   ├── style.css         # Idira tokens
│   ├── portal.js         # left-pane app logic
│   └── inspector.js      # right-pane SSE consumer
├── handler.go            # serves /, /resolve (POST), /trace (SSE multiplex)
├── carrier_client.go     # mTLS client, calls carrier:/lookup
├── trace.go              # local trace bus; merges own events + carrier's SSE
├── Dockerfile
└── README.md
```

Responsibilities:
- Serve `ui/` static at `/`.
- On POST `/resolve` with `{shipment_id}`:
  1. Emit `portal.resolve.requested id={id}`.
  2. Open mTLS client to `carrier.swa-demo.svc.cluster.local:8443` using its own X.509-SVID. Emit `mtls.handshake.start peer=spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier`.
  3. Call `/lookup/{id}` on carrier. Emit `mtls.handshake.ok`.
  4. Subscribe to carrier's `/trace` SSE during the request (concurrent goroutine), forward each event into portal's own trace bus with prefix `carrier.*` preserved.
  5. Return shipment JSON to browser.
- Serve `/trace` SSE: pushes all trace events from portal's bus to the browser, keyed by a per-tab session.

### 9.3 Service-to-service mTLS

`tlsconfig.MTLSClientConfig` and `tlsconfig.MTLSServerConfig` from go-spiffe handle the heavy lifting. Authorizer is `AuthorizeID(spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier)` on the portal side and `AuthorizeID(spiffe://idira.demo/kind-ng/ns/swa-demo/sa/portal)` on the carrier side — explicit allow-list, not "AuthorizeAny".

### 9.4 Inspector data flow

Three event sources merge into the inspector:
1. **Portal-local events** (its own state transitions) — emitted directly to its trace bus.
2. **Carrier events** — portal subscribes to `carrier:8444/trace` over **mTLS** (the carrier serves the trace endpoint on a separate port with the same SVID material; portal authorizes the carrier SPIFFE ID). Open only for the duration of one resolve.
3. **Browser** — establishes one long-lived SSE connection to `portal:8080/trace`, receives merged events as `data: {ts, source, type, payload}\n\n`.

Events are JSON with stable shape:
```json
{"ts": "2026-05-27T14:02:11.123Z", "source": "portal|carrier",
 "type": "mtls.peer_verified", "payload": {"peer": "spiffe://..."}}
```

Inspector renders each event as a typeset row with the source as an eyebrow, the SPIFFE ID monospaced, and a tiny status glyph (line-only icon per brand). No animations beyond a 120 ms fade-in.

## 10. Visual design system

### 10.1 Brand tokens (CSS custom properties)

```css
:root {
  /* Idira (primary brand for this surface) */
  --idira-0:    #ADC0FC;
  --idira-250:  #6186FC;
  --idira-500:  #265BFF;   /* primary accent */
  --idira-750:  #173EB8;
  --idira-1000: #061D63;

  /* PANW parent palette (used sparingly for alerts/heat) */
  --panw-orange: #FA582D;
  --panw-ink:    #190000;

  /* Neutrals — derived, not invented */
  --bg:        #FFFFFF;
  --bg-inspector: #0B0D14;  /* near-black with subtle blue cast */
  --text:      #190000;
  --text-mute: #4A4A52;
  --line:      #D8D8DF;
}
```

Idira gradient: `linear-gradient(180deg, var(--idira-500) 0%, var(--idira-1000) 100%)` — linear only, never radial. Used for hero areas; never on body backgrounds.

### 10.2 Typography

| Role | Stack | Notes |
|---|---|---|
| Headlines | `"TT Hoves", "Inter", -apple-system, sans-serif` | TT Hoves is licensed; if unlicensed, the system fallback chain looks acceptable. Sentence case. Letter-spacing `-0.015em` at headline sizes. |
| Body | `"Helvetica Neue", Helvetica, Arial, -apple-system, sans-serif` | Brand-blessed for HTML. Helvetica Neue leads (brand-mandated) so macOS does not silently substitute San Francisco via `-apple-system`. Default 16px / 26px line-height per brand guide. |
| Mono (inspector) | `ui-monospace, "SF Mono", Menlo, monospace` | For SPIFFE IDs, hashes, timestamps. |
| Long-form prose | `"FF Celeste", Georgia, serif` | Only if we add documentation pages; not used in core UI. |

### 10.3 Layout

The portal page is a 50/50 split at viewports ≥1024px, stacking vertically below. Both panes have generous internal padding (24px desktop, 16px mobile) and a single-column information hierarchy. No card grids. No hero gradients on the portal pane (white). Inspector pane uses `--bg-inspector` with mono type and `--idira-0` for muted labels.

### 10.4 Component patterns

- **CTA button**: fill style preferred for primary actions (`background: var(--text)`, `color: white`, `padding: 14px 22px`, `font: 700 13px/1 "TT Hoves"`, `letter-spacing: 0.14em`, `text-transform: uppercase`, square corners, no shadow). Per brand guide, font-size is 1/3 of button height, side padding 1/5 of width.
- **Status pill** (inspector): square-cornered rect, `border: 1px solid currentColor`, `padding: 2px 8px`, mono 11px.
- **Icons**: line-only, `1.5px` stroke at 24px artboard; never filled. Sourced as inline SVG, hand-tuned. No icon library imports.
- **Idira lockup**: small wordmark `Idira` in TT Hoves Bold at the portal pane's top-left, with `BY PALO ALTO NETWORKS` signature in Ringside-equivalent (Inter Black at 9px / 0.18em letter-spacing) underneath. Lockup respects brand-guide clearspace.

### 10.5 Voice and copy

Sentence case throughout. No exclamation marks. No "🚀". No "Let's...". No "Built with [X] and ❤️". Inspector event labels are lowercase, dot-separated technical strings (e.g., `mtls.peer_verified`) — they are deliberately raw because that's what an operator would actually see in a log. Headline candidates: *"Workloads with real identity."*, *"Identity, not credentials."*, *"Nothing static. Nothing to leak."*

### 10.6 What NOT to do

Concrete anti-patterns flagged for the implementer:
- No `bg-gradient-to-r from-purple-500 to-pink-500` or any equivalent. Brand violation.
- No emoji at all. None.
- No `<Card>` / `<CardHeader>` shadcn-stock layouts.
- No "Built with Claude" / "AI-powered" copy.
- No 12-column grid scaffolding visible to the user.
- No skeleton-loaders for a request that returns in <300ms.

## 11. Repo layout

```
idira-swa-demo/
├── apps/
│   ├── carrier/                  # Go service (§9.1)
│   └── portal/                   # Go service + UI bundle (§9.2, §10)
├── platform/
│   ├── helm/                     # values yaml files (§8.2)
│   └── terraform/                # TF module (§7.1)
├── scripts/
│   ├── get-sm-token.sh           # two-hop OAuth (§6.1)
│   ├── kind-oidc.sh              # JWKS extractor for TF external data (§7.3)
│   └── grade-spec.sh             # rubric runner stub (§13.4)
├── docs/superpowers/specs/       # this file
├── swa-release-1.0.4/            # vendor bundle (gitignored)
├── swa-docs/                     # docs mirror (existing)
├── DEPLOY_MACOS.md               # existing runbook (still authoritative for path A/B)
├── CLAUDE.md                     # project guidance (existing)
├── Makefile                      # see §12
└── README.md                     # demo entry point — what it is, how to run
```

## 12. Makefile targets

```make
SHELL := bash
.SHELLFLAGS := -euo pipefail -c

# Required env (.envrc.example documents these):
#   PANW_IDENTITY_TENANT, PANW_SM_TENANT, IDIRA_CLIENT_ID, IDIRA_CLIENT_SECRET,
#   PANW_OIDC_APP_SCOPE (default "conjur")
# Derived:
PANW_SM_URL := https://$(PANW_SM_TENANT).secretsmgr.cyberark.cloud
TF := terraform -chdir=platform/terraform

.PHONY: help up down doctor tf-token tf-plan tf-apply-platform tf-apply-app \
        cluster images install-server install-agent build-apps deploy-apps \
        portforward smoketest

help:               ## Show this help
	@awk 'BEGIN{FS=":.*##"} /^[a-zA-Z_-]+:.*##/{printf "%-22s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

doctor:             ## Verify prerequisites (docker, kind, kubectl, helm, terraform, jq, curl)
	@./scripts/doctor.sh

up: doctor cluster images tf-apply-platform install-server install-agent \
    build-apps deploy-apps tf-apply-app smoketest ## Full deploy
	@echo "Demo ready. Run: make portforward"

down:               ## Tear everything down (cluster + tenant objects)
	-helm -n swa-system uninstall swa-agent swa-server
	-kubectl delete ns swa-demo swa-system --wait=false
	-kind delete cluster --name swa
	-CONJUR_AUTHN_TOKEN=$$(./scripts/get-sm-token.sh) \
	  CONJUR_APPLIANCE_URL=$(PANW_SM_URL) \
	  $(TF) destroy -auto-approve

tf-token:           ## Print the env vars to source for manual terraform use
	@echo "export CONJUR_APPLIANCE_URL=$(PANW_SM_URL)"
	@echo "export CONJUR_AUTHN_TOKEN=$$(./scripts/get-sm-token.sh)"

# ... (cluster, images, install-server, install-agent, build-apps, deploy-apps,
#      portforward, smoketest targets each ≤8 lines, see implementation plan.)
```

## 13. Agent-team builder/validator pattern

### 13.1 Why

The user's requirement: each implementation milestone (M1, M2, M3) is built by a *builder* agent and graded by a *validator* agent before being considered complete. The validator must give the work a 9/10 or higher on the rubric in §13.4. If below, the validator returns concrete findings; the builder addresses them and re-submits.

This catches: hallucinated TF resource names, mTLS configurations that compile but use wildcard authorizers, UI that compiles but has AI-stock markers, etc. — failure modes the builder is biased not to see.

### 13.2 Team composition

Per Claude Code agent-teams docs (https://code.claude.com/docs/en/agent-teams), the lead spawns the team. For each milestone:

```
team: idira-swa-demo
  lead       (the current Claude session)
  builder-M{n}    subagent_type: general-purpose
                  prompt: §13.5
  validator-M{n}  subagent_type: general-purpose
                  prompt: §13.6, runs in plan-mode (read-only)
                  enforces: 9/10 rubric
```

Builder and validator are spawned per milestone; they shut down after the milestone passes. This keeps token cost bounded and prevents context bleed across milestones.

`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` must be set in settings.json before M1 starts. The lead checks this in M1's first task.

### 13.3 Loop mechanics

1. Lead creates the milestone task in the shared task list (`TaskCreate`), assigns to `builder-M{n}`.
2. Builder works the task, produces code + a brief self-assessment, marks the task `completed`, sends a message to `validator-M{n}` with "ready for review".
3. Validator reads the diff, runs whatever verification commands the rubric requires (it can `Bash`), and produces a score `0-10` with per-criterion breakdown.
4. If score ≥9: validator marks a `M{n}-validated` task as completed, lead progresses to next milestone.
5. If score <9: validator creates `M{n}-revision` tasks (one per failing criterion), assigns them back to builder. Builder addresses, marks revision tasks done, re-pings validator. Loop.
6. Hard cap: 3 revision cycles. If still <9 after 3, lead pauses and surfaces to the user with the validator's findings.

### 13.4 Quality rubric (10 criteria, 1 point each, threshold 9)

Rubric is **the same for every milestone**, but each criterion is interpreted in that milestone's context.

| # | Criterion | Pass means |
|---|---|---|
| 1 | **Compiles / applies cleanly** | `go build ./...`, `terraform validate`, `helm lint`, `make build` — whichever apply, all exit 0 with no warnings the rubric considers material. |
| 2 | **Behavioral verification passes** | The milestone's smoketest (§14) succeeds end-to-end against a fresh `make up`. Not "the code looks right" — actually ran. |
| 3 | **No hallucinated identifiers** | Every TF resource name, helm value key, Go function, k8s API kind, and CLI flag used in the diff is verified to exist (in bundled docs, source, or kubectl explain). Validator names each one it spot-checked. |
| 4 | **No wildcard trust** | mTLS authorizers explicit (`AuthorizeID`, not `AuthorizeAny`). SM policy restricted to one secret. Helm `rbac` not opened beyond `TokenReview`. No `:latest` image tags. |
| 5 | **No AI-generation markers** | (M3 especially): no emoji, no purple gradients, no stock shadcn/Tailwind defaults, no "powered by AI" copy, no marketing fluff. Validator names each visual element it spot-checked against §10. |
| 6 | **Brand fidelity** | Idira Blue used, Helvetica Neue / TT Hoves applied, sentence case headlines, ALL CAPS CTAs, line-only icons. Validator opens one screenshot from `make smoketest` and confirms. |
| 7 | **Failure modes addressed** | At least one error path tested (carrier socket missing, SM 401, kind unreachable). Inspector shows the error rather than the UI hanging silently. |
| 8 | **Scope discipline** | No new dependencies that weren't in the spec. No "while I was here…" refactors. No speculative abstractions for hypothetical features. |
| 9 | **Documentation in code** | README updated, env-var requirements documented in `.envrc.example`, any non-obvious decision has a one-line comment with *why*. |
| 10 | **Cleanup leaves no trace** | `make down` removes all cluster + tenant state. Validator runs `make up && make down` and confirms `terraform state list` is empty and `kubectl get ns` doesn't show `swa-system` or `swa-demo`. |

A single criterion failing drops the score by 1. A criterion is binary — partial credit is too fuzzy and invites builder rationalization.

### 13.5 Builder prompt template

```
You are the builder for milestone M{n} of the Idira SWA demo (spec at
docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md, sections {x.y}).

Your task: {milestone-specific implementation}.

Constraints (will be graded on §13.4):
- Verify every identifier you use against bundled docs or `kubectl explain` /
  `terraform providers schema`. Do not guess names.
- Use explicit `AuthorizeID`, never `AuthorizeAny`.
- (M3) no emoji, no purple gradients, no shadcn defaults, no "AI"/"powered by"
  copy. Read §10 (visual system) before writing any UI code.
- Run `make smoketest` against a fresh `make up` before declaring done.
- When done, mark your task `completed` and message validator-M{n}:
  "M{n} ready for review. Diff: {paths changed}. Smoketest output: {tail}."
```

### 13.6 Validator prompt template

```
You are the validator for milestone M{n} of the Idira SWA demo.

Spec: docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md
Rubric: §13.4 of that spec (10 criteria, 1 point each, pass at ≥9).

Workflow:
1. Read the spec sections relevant to M{n}.
2. Read the diff (`git diff HEAD~ -- ...`).
3. Re-run `make smoketest` from a fresh `make up`. If that fails, score 0 on
   criterion #2 immediately.
4. For each of the 10 criteria, write one line: PASS or FAIL with the
   evidence (file:line, command output, screenshot path).
5. Total the score. If ≥9, mark task `M{n}-validated` completed and message
   the lead. If <9, create per-criterion revision tasks for builder-M{n}.

Permissions: read-only (plan mode). You may run Bash for verification.
You may not modify code.

Important: be hostile to plausible-sounding mistakes. The builder will
rationalize. The user has explicitly asked you to be strict.
```

## 14. Phased milestones

### 14.1 M1 · Platform up

**Deliverable**: `make up` (subset: `cluster images tf-apply-platform install-server install-agent`) yields a kind cluster with healthy `swa-server` and `swa-agent` pods, SPIFFE hierarchy created on the tenant, server registered with inline JWKS. `kubectl -n swa-system get pods` shows all Ready.

**Smoketest**: `kubectl -n swa-system logs deploy/swa-server | grep -q "Successfully authenticated"` and `kubectl -n swa-system get ds/swa-agent` shows desired==ready.

**Validator focus**: TF resource names verified via `terraform providers schema -json` (no `docs/` directory ships with the provider — see §16 OQ #1). Inline JWKS injection works (server doesn't try to call back to the laptop). Agent workload key.type override (RSA, §8.2) is in effect — `kubectl -n swa-system get cm swa-agent-config -o jsonpath='{.data}'` shows `RSA2048` not `ECP256` for `workload.key.type`.

### 14.2 M2 · Backend identity + secret

**Deliverable**: `carrier` deployed; JWT authn + policy + secret applied via TF; `carrier` can resolve a shipment ID end-to-end (return canned data) using a secret it fetched via JWT-SVID.

**Smoketest**: `kubectl -n swa-demo exec deploy/portal -- curl -sf carrier:8443/lookup/SHP-2049-883` returns expected JSON. Server logs show no auth failures.

**Validator focus**: no wildcard authorizer, secret scoped to one variable, JWT authn variables match §6.3 exactly (`jwks-uri` pointing at SWA's per-trust-domain JWKS, `token-app-property: sub`, `audience: conjur`), workload JWT-SVID is RSA-signed (`workload.key.type: RSA2048` in the agent configmap), error path tested (delete the secret, confirm carrier returns 502 with structured error).

### 14.3 M3 · Frontend split UI

**Deliverable**: `portal` serves the split-pane UI; clicking RESOLVE SECRET fires the whole click sequence (§5.3); inspector shows live trace events with correct SPIFFE IDs, timing, and status glyphs.

**Smoketest**: `make portforward` + a headless browser run (`scripts/smoke-ui.sh`) that loads `localhost:8080`, fills the form, clicks resolve, and asserts the inspector shows all six event types within 3 seconds. Screenshot saved to `out/m3-smoke.png`.

**Validator focus**: brand fidelity (§10) — opens the screenshot, confirms Idira Blue, Helvetica Neue, sentence case, no emoji, no AI markers. Inspector trace events match the spec's shape.

## 15. Verification

Every `make smoketest` invocation is the canonical acceptance check; nothing else counts. Smoketest is **not** a unit test suite — it is the end-to-end happy path. Unit tests live next to code and are run by `make test`, which is *not* gated by the rubric (rubric is acceptance-only).

Failure modes that must be handled (and shown in the inspector, not just logged):

| Failure | Inspector event | Recovery |
|---|---|---|
| Workload API socket missing | `agent.unreachable` | Surface "Agent not ready" toast in portal. Don't crash. |
| SM authn-jwt 401 | `sm.authn_jwt err code=401` | Surface "Identity rejected" toast. Most likely cause: clock skew or JWKS mismatch. |
| SM secret 403 | `sm.secret_fetched err code=403` | Surface "Policy denies access". Most likely cause: SPIFFE ID changed after authn was bound. |
| Carrier shipment not in fixture | `carrier.lookup miss id=…` | Surface "Shipment not found" in result pane (this is a UX path, not an error). |
| Tenant unreachable | `sm.network err` | Surface "Tenant unreachable" with the URL it tried. |

## 16. Open questions and risks

1. **Exact TF resource names** in the bundled provider (`swa_trust_domain` etc.). The bundle does **not** ship provider docs (`swa-release-1.0.4/terraform-provider/` contains only the per-platform binaries plus `SHA256SUMS*` — verified). Discovery path in M1: install the provider, write a stub `provider "swa" {}` block, then `terraform providers schema -json | jq '.provider_schemas[] | keys'`. Fall back to `strings ./terraform-provider-swa_* | grep -E '^swa_'` and the bundled binary's `--help` if available.
2. **~~`PANW_OIDC_APP_SCOPE` value~~ — RESOLVED 2026-05-27.** The operator's auth flow uses Service User `client_credentials` against `/Oauth2/Token/__idaptive_cybr_user_oidc` with **`scope=api`** (not `conjur`). Credentials come from Conceal at `infamousdev/claudecode/client_id|secret`, surfaced via `summon -p conceal_summon`. The Identity URL is discovered via Platform Discovery (`https://platform-discovery.cyberark.cloud/api/v2/services/subdomain/<subdomain>`) — `<subdomain>.id.cyberark.cloud` does NOT exist; the real Identity URL uses a tenant ID like `ack4386.id.cyberark.cloud`. See §6.1 and `~/Documents/Projects/panw/memory/cyberark-tenant.md`.
3. **~~JWT authenticator configuration mechanism~~ — RESOLVED 2026-05-27.** The bundled `cyberark/swa` provider does NOT ship a JWT-authenticator, policy, or variable resource — verified by `terraform providers schema -json` (only `swa_trust_domain`, `swa_server_group`, `swa_node_group`, `swa_server` exist). Conjur policy / variables / authenticators are managed via the separate `cyberark/conjur` Terraform provider from the public registry. See §7.1 amendment.
4. **Inline JWKS staleness on SWA Server registration** — kind rotates its serving cert on cluster restart. The `20-server.tf` registration embeds kind's JWKS inline at apply time. `make up` re-applies `20-server.tf` which re-reads the JWKS, but if the operator restarts the kind cluster without `make up`, the SWA Server will fail to PSAT-attest. Document in README; `make restart` should trigger a partial re-apply. *Note: this affects only the SWA Server's bootstrap PSAT path — the workload JWT authenticator in §6.3 uses SWA's per-trust-domain JWKS, which is published by SWA itself and is not affected by kind restarts.*
5. **Token expiry mid-demo** — the carrier caches its SM access token (8 min TTL per docs) but doesn't currently refresh. Acceptable for a demo (a single click is sub-second), but the README should note it. The two-hop OAuth helper (§6.1) operator token is similarly short-lived (≤15 min) and is re-fetched per Make target.
6. **Audience claim consistency** — the JWT-SVID `audience`, the JWT authenticator `audience` variable, and the SWA Server chart's `controlPlane.auth.audience` must all match. Spec uses `conjur` everywhere (chart default). If any of the three are overridden in the future, all three must be updated together.

## 17. Approval

Spec is ready for:
1. Self-review (placeholder/contradiction/scope check) — done inline by the author.
2. **Validator subagent grade** (rubric §13.4) — pending.
3. User review — pending validator pass.
4. After approval, invoke `superpowers:writing-plans` to produce the implementation plan.
