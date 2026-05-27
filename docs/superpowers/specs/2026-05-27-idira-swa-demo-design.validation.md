# Validation report — Idira SWA Demo design spec

**Spec under review:** `docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md` (610 lines)
**Date:** 2026-05-27
**Validator:** strict; hostile to plausible-sounding mistakes per user instruction.

## Per-criterion grade

1. **Completeness — PASS**
   Evidence: §16 enumerates 5 named open questions (TF resource names, OIDC scope value, JWT authenticator REST shape, JWKS rotation in kind, token expiry). No `TODO` / `TBD` markers in the body (`grep -n 'TODO\|TBD\|XXX\|FIXME'` returns nothing material). Every section has concrete content rather than handwaving.

2. **Internal consistency — PASS**
   Evidence: trust domain `idira.demo` is used identically in §5.1, §5.3, §7.3 (`swa_trust_domain.idira.name`), §8.2 helm values (lines 216, 226), and SPIFFE IDs throughout. Namespace `swa-demo` is identical in §5.1, §5.3, §7.1, §8.4, §9, §12, §14. ServiceAccount names `portal`/`carrier` consistent in §8.3 and §9.3. Cluster name `kind-swa` matches §8.1 `kind create cluster --name swa` and §8.2 `nodeAttestor.k8s_psat.cluster: kind-swa`.
   Nit (non-blocking): the TF variable is named `node_group` (§7.1 line 141) but the only concrete node-group value used in the spec is `kind-ng` (helm `podLabels.swa_nodegroup`). They line up implicitly, not explicitly.

3. **Technical correctness — auth & SPIFFE — FAIL**
   Evidence and findings (multiple):
   - **JWT-SVID signing algorithm is wrong.** Agent chart defaults: `agent.key.type: ECP256` and `workload.key.type: ECP256` (`/tmp/swa-agent/values.yaml:32,59`). The SM JWT authenticator docs explicitly require RSA: *"You must use RSA signing (`RS*` with `RSA_*`) with the JWT authenticator. Elliptic-curve signing is not supported on that path."* (`swa-docs/pages/cjr-authn-jwt-swa.md:16`). The spec does not override these chart defaults anywhere in §6.3, §8.2, or §9. As written, the JWT-SVID handed to SM will be EC-signed and the authenticator will reject it. The whole §5.3 click sequence breaks at step 4.
   - **JWT authenticator trust anchor is wrong.** §6.3: *"The JWT authenticator (`authn-jwt/swa`) is configured in §7 via TF with `token-app-property: spiffe_id`, `signing-key: <kind cluster JWKS>`, `issuer: <kind issuer>`."* The docs say the authenticator must trust **SWA's** issuer + JWKS (`https://<tenant>.secretsmgr.cyberark.cloud/api/swa/trust-domains/<trust-domain>` and `.../.well-known/jwks`), not kind's (`swa-docs/pages/cjr-authn-jwt-swa.md:86,99-100,108-109`). The spec conflates the SWA Server's PSAT registration (which uses kind's OIDC) with the workload JWT authenticator (which uses SWA's OIDC). Open question #4 doubles down on the wrong model by treating kind-JWKS rotation as a JWT-authenticator concern.
   - **`token-app-property` value is wrong.** Spec §6.3 sets `token-app-property: spiffe_id`. The docs say the value must be `sub` — that is the *claim name* the authenticator extracts; the SPIFFE ID happens to live in the `sub` claim (`swa-docs/pages/cjr-authn-jwt-swa.md:91,103`). `spiffe_id` is not a valid token-app-property value.
   - **SPIFFE ID shape is missing the node-group segment.** Spec uses `spiffe://idira.demo/ns/swa-demo/sa/portal` everywhere (§5.1, §5.3, §9.3). Per `swa-docs/pages/ccl-swa-node-groups-design.md:29-30`, the workload SPIFFE template is `spiffe://<td>/<nodegroup>/ns/<ns>/sa/<sa>` (example: `spiffe://example.org/k8s-production/ns/payments/sa/processor`). The spec's IDs omit the `<nodegroup>` segment, so the `tlsconfig.AuthorizeID(...)` calls in §9.3 will never match an actual issued SVID.
   - Two-hop OAuth helper structure (§6.1) and `Authorization: Token token="..."` header (§5.1, §9.1) are consistent with `DEPLOY_MACOS.md:161,222`. Those parts are sound.

4. **Identifier verification — FAIL**
   Evidence:
   - Server-chart `trustDomain.name` does not exist. The spec sets it in `platform/helm/swa-server.values.yaml` (§8.2, lines 215-216: `trustDomain: name: idira.demo`). `grep -n "trustDomain\|trust_domain" /tmp/swa-server/values.yaml` returns nothing, and `grep -rn "trustDomain" /tmp/swa-server/templates/` returns nothing — the chart silently ignores the key. The upstream Helm doc (`swa-docs/pages/ccl-swa-install-helm.md:41,83`) misleadingly lists it as a server-chart parameter, but the actual bundled chart `swa-release-1.0.4/helm/swa-server-0.1.0.tgz` does not honor it. `DEPLOY_MACOS.md:82-92` Path B's server install does not pass it. Spec follows the bad upstream doc.
   - `swa-release-1.0.4/terraform-provider/docs/` does not exist. Verified: `ls swa-release-1.0.4/terraform-provider/` shows only platform-suffixed binaries plus `SHA256SUMS{,.sig}`, no `docs/` directory. The spec's §7.4 note states as fact: *"The provider ships docs at `swa-release-1.0.4/terraform-provider/docs/` per upstream; the builder's first task in M1 is to open that and confirm/correct names."* §16 OQ #1 also says *"to verify by opening `swa-release-1.0.4/terraform-provider/docs/`"*. The validator note in the task setup explicitly confirms this path does not exist. The spec calls it an open question but still asserts the file location exists. The builder will spend cycles looking for a non-existent directory.
   - Other helm keys verified present: `controlPlane.url` (server:18), `controlPlane.auth.loginURL` (server:24), `rbac.createTokenReviewRole` (server:72), `trustDomain.name` (agent:13), `nodeAttestor.type` (agent:37), `nodeAttestor.k8s_psat.cluster` (agent:44), `server.address` (agent:24), `podLabels.swa_nodegroup` (agent:150). All confirmed.
   - TF resource names (`swa_trust_domain`, `swa_server_group`, `swa_node_group`, `swa_server`, `swa_variable`) are flagged as an open question in §16 — that part is honest. But the wrapping claim about a docs directory undermines the honesty.

5. **Risk identification — PASS**
   Evidence: §4 constraints table and §16 cover all five required risks: tenant-cannot-reach-kind / inline-public-keys fix (§4 row "Laptop", §7.3); short-lived bearer tokens with per-call helper rerun (§6.2, §16 OQ #5); JWKS rotation on kind restart (§16 OQ #4); arm64-only images (§4 row "Bundle", §8.2 image tag `0.0.0-SNAPSHOT-arm64v8`); SM access token 8 min TTL (§16 OQ #5).

6. **Brand fidelity — PASS**
   Evidence: §10.1 specifies actual Idira tokens (`--idira-500: #265BFF`, `--idira-1000: #061D63`, etc.). §10.2 stack is `"TT Hoves" / Inter / -apple-system` for headlines and `-apple-system / "Helvetica Neue" / Helvetica / Arial` for body. §10.4 specifies sentence case for headlines and ALL CAPS for CTAs (`text-transform: uppercase`, `letter-spacing: 0.14em`, 13px). §10.4 also requires line-only iconography at 1.5px stroke. §10.1 prescribes linear gradients only ("never radial"). §10.6 lists concrete anti-patterns: no `bg-gradient-to-r from-purple-500 to-pink-500`, no emoji, no `<Card>` shadcn defaults, no "AI-powered" copy, no skeleton-loaders. Idira Blue is primary; Cyber Orange reserved for accent only (correct sub-brand assignment).

7. **Implementability — PASS**
   Evidence: every component has concrete file paths (§9.1 `apps/carrier/{main.go,handler.go,sm_client.go,fixture/shipments.json,trace.go,Dockerfile,README.md}`; §9.2 mirrored for portal; §11 repo tree). Function names from go-spiffe given (`WorkloadAPIClient.FetchJWTSVID`, `tlsconfig.MTLSServerConfig`, `tlsconfig.MTLSClientConfig`, `tlsconfig.AuthorizeID`, `tlsconfig.AuthorizeMemberOf`). Env-var contract documented (§12 header comment names the required vars). Service-to-service handoff explicit (§5.3 numbered click sequence; §9.4 inspector data flow). The technical correctness gaps from criterion 3 will require returning to revise — but the spec's per-component detail level is high.

8. **Scope discipline — PASS**
   Evidence: §3 enumerates 5 explicit non-goals (production hardening, multi-cluster, non-Apple-Silicon, PANW brand-review approval, real third-party APIs). §14 phases are bounded single-deliverables (M1 platform up; M2 backend identity + secret; M3 frontend split UI). No speculative abstractions (no plugin system, no `pkg/identity/`-style framework layer). No "while I was here" features (no auth proxy, no service mesh sidecar, no policy engine).

9. **Verification rigor — PASS**
   Evidence: each milestone has a concrete smoketest command:
   - M1 (§14.1): `kubectl -n swa-system logs deploy/swa-server | grep -q "Successfully authenticated"` plus `kubectl -n swa-system get ds/swa-agent` desired==ready.
   - M2 (§14.2): `kubectl -n swa-demo exec deploy/portal -- curl -sf carrier:8443/lookup/SHP-2049-883`.
   - M3 (§14.3): `scripts/smoke-ui.sh` headless browser run + screenshot to `out/m3-smoke.png`.
   §15 explicitly says *"Every `make smoketest` invocation is the canonical acceptance check; nothing else counts."* Acceptance is observable behavior, not "looks right".

10. **Failure-mode coverage — PASS**
    Evidence: §15 table enumerates 5 failure modes (Workload API socket missing, SM authn-jwt 401, SM secret 403, shipment not found, tenant unreachable). Each row specifies a concrete inspector event (`agent.unreachable`, `sm.authn_jwt err code=401`, etc.) AND a user-visible UX (toast text, result-pane message). The spec distinguishes UX paths ("Shipment not found" is a UX path, not an error). Failure detection is wired into the inspector, not buried in logs.

## Total

**Total: 8 / 10**
**Verdict: FAIL (threshold is ≥9)**

## Revision tasks (must address before resubmission)

1. **Fix the JWT-SVID signing algorithm.** Set `agent.key.type` and especially `workload.key.type` to an RSA variant (`RSA2048` or similar — verify the exact enum string the chart accepts) in `platform/helm/swa-agent.values.yaml`. Add a one-line note in §6.3 or §8.2 explaining that the SM JWT authenticator rejects EC-signed JWTs.

2. **Fix the JWT authenticator trust anchor.** Update §6.3 and the §7 JWT-authn TF resources to set `signing-key`/`jwks-uri` to SWA's per-trust-domain JWKS URL (`https://infamous.secretsmgr.cyberark.cloud/api/swa/trust-domains/idira.demo/.well-known/jwks`) and `issuer` to the SWA trust-domain base URL — not kind's OIDC. The kind OIDC issuer is *only* used for §7.3 server registration (`20-server.tf`). Move OQ #4 to be about the SWA Server's inline public-keys staleness only.

3. **Fix `token-app-property` value.** §6.3 must say `token-app-property: sub`, not `spiffe_id`. The SPIFFE ID is *carried in* the `sub` claim; `sub` is the claim selector the authenticator needs.

4. **Fix the SPIFFE ID shape.** Update every SPIFFE ID in §5.1, §5.3, §9.3, and §13.5 to include the node-group segment per the documented template: `spiffe://idira.demo/kind-ng/ns/swa-demo/sa/portal` (or whatever node-group name the spec settles on). The `AuthorizeID` calls in §9.3 currently reference IDs that no agent will ever issue.

5. **Drop or correct the server-chart `trustDomain.name` claim.** Either (a) remove `trustDomain.name: idira.demo` from the server values snippet in §8.2 since the bundled chart silently ignores it, OR (b) add a footnote acknowledging the upstream Helm doc is wrong and we set it defensively in case a future chart version honors it. Don't pretend the chart consumes it.

6. **Stop claiming `swa-release-1.0.4/terraform-provider/docs/` exists.** Rewrite §7.4 note and §16 OQ #1 to acknowledge the bundle ships no provider docs directory. State the actual M1 discovery path: `terraform providers schema -json` against an empty provider block, or inspecting the binary with `terraform-provider-swa --help`/`strings`, or fetching the upstream provider source if available. Misleading the builder into hunting a phantom directory wastes a revision cycle.

## Non-blocking nits

- §10.2 mixes `"Helvetica Neue"` (body) with `-apple-system` first. On macOS that resolves to San Francisco, not Helvetica. If the brand guide says Helvetica Neue is mandatory, lead with it; if `-apple-system` is acceptable, leave a note.
- §14.1 smoketest greps for the literal string `"Successfully authenticated"` in server logs. Worth confirming that's the actual phrase the `0.0.0-SNAPSHOT` server emits before locking the validator on it.
- §7.1 names the variable `node_group` (singular) but the resource is `swa_node_group`. Fine, but a one-line variables.tf snippet showing the variable default value would lock in the implicit `kind-ng`.
- §6.1 helper hard-codes `Accept-Encoding: base64` on the SM authn-oidc call but doesn't decode in the script. Worth clarifying whether the helper output IS the base64 token or whether the caller decodes.
- §13.2 references `https://code.claude.com/docs/en/agent-teams` and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` as environmental gates. Worth confirming these are still current names in the harness the lead session runs in.
