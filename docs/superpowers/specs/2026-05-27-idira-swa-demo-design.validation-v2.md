# Validation report v2 — Idira SWA Demo design spec (re-grade)

**Spec under review:** `docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md` (639 lines, was 610)
**Date:** 2026-05-27
**Validator:** strict; same standard as v1.
**Predecessor report:** `2026-05-27-idira-swa-demo-design.validation.md` (8/10, FAIL).

## Summary of fixes verified

All six v1 FAIL findings have substantive responses in this draft. Per-criterion verification below.

## Per-criterion grade

1. **Completeness — PASS**
   Evidence: §16 expanded from 5 to 6 open questions (new OQ #6 on audience consistency). No `TODO/TBD/FIXME/XXX` markers in body (`grep -n` returns nothing). Every section retains concrete content; fixes added detail without leaving gaps.

2. **Internal consistency — FAIL**
   Finding: §14.2 line 600 (M2 validator focus) still reads *"JWT authn signing-key matches kind's JWKS, error path tested..."* This directly contradicts the corrected §6.3 table (line 136), which now explicitly states: *"`jwks-uri` ... SWA publishes a per-trust-domain JWKS. This is **not** kind's JWKS (that is only used for SWA Server PSAT registration in §7.3)."* Also contradicts OQ #4 (line 629), which adds: *"the workload JWT authenticator in §6.3 uses SWA's per-trust-domain JWKS, which is published by SWA itself and is not affected by kind restarts."* The leftover at line 600 is a v1 artifact the revision missed. An M2 validator following §14.2 literally would mark PASS on the wrong configuration (`kind.local:6443/openid/v1/jwks` rather than `…/api/swa/trust-domains/idira.demo/.well-known/jwks`).
   Other identifier strings (`idira.demo`, `kind-ng`, `kind-swa`, `swa-demo`, `secureWorkloadAccess`, `conjur`) consistent throughout.

3. **Technical correctness — auth & SPIFFE — PASS**
   Evidence (each of v1's four sub-findings):
   - **RSA-signed JWT-SVID:** §6.3 line 144 now has the explicit RSA callout. §8.2 lines 253-260 set `agent.key.type: RSA2048` and `workload.key.type: RSA2048` with a CRITICAL comment. Verified the chart consumes both keys at `/tmp/swa-agent/templates/configmap.yaml:22,36`. §14.1 validator focus (line 592) adds a configmap inspection check (`kubectl ... get cm swa-agent-config ... | grep RSA2048`). M1 fallback enum list (`rsa-2048`, `RSA-2048`) is a sensible hedge against unknown chart enum string.
   - **JWT authenticator trust anchor:** §6.3 table (lines 132-141) lists the five Conjur-style variables with values that match `swa-docs/pages/cjr-authn-jwt-swa.md:88-94` exactly. `jwks-uri` points at `…/api/swa/trust-domains/idira.demo/.well-known/jwks`; `issuer` at the trust-domain base URL; `identity-path` at `data/swa/trust-domains/idira.demo/workloads`.
   - **token-app-property:** line 138 now reads `sub` with an explanation that the SPIFFE ID lives in the `sub` claim. All references to `spiffe_id` as a value removed (verified via grep).
   - **SPIFFE ID shape:** verified by `grep -n 'spiffe://idira.demo/ns/' spec` — returns zero matches. All workload SPIFFE IDs now `spiffe://idira.demo/kind-ng/ns/.../sa/...` (§5.1 lines 68-70, §5.3 line 82, §6.3 line 142, §8.3 line 269 explicitly declares the node-group template, §9.2 line 333, §9.3 line 341).

4. **Identifier verification — PASS**
   Evidence:
   - Server-chart `trustDomain.name` removed from §8.2 (lines 220-237). The block now sets only `image`, `controlPlane` (with `auth.audience: conjur` set explicitly — verified honored at `/tmp/swa-server/templates/deployment.yaml:109`), and `rbac`. Inline note at lines 233-236 acknowledges the bundled chart does not honor `trustDomain.name` and that the upstream Helm doc is inaccurate. This is exactly the requested fix.
   - `terraform-provider/docs/` claim corrected. §7.4 note (line 202) now states: *"The bundle does **not** ship a `docs/` directory alongside the provider binary (verified)."* §16 OQ #1 (line 626) repeats the verification and gives three concrete discovery paths: (a) `terraform providers schema -json`, (b) `strings ./terraform-provider-swa_* | grep -E '^swa_[a-z_]+$'`, (c) cross-reference upstream SWA Helm CRDs. §14.1 validator focus (line 592) routes via `terraform providers schema -json`.
   - Helm value keys re-verified against extracted charts: `controlPlane.url` (server:18), `controlPlane.auth.loginURL` (server:24), `controlPlane.auth.audience` (server:28, used in deployment:109), `rbac.createTokenReviewRole` (server:72), `trustDomain.name` agent-only (agent:13), `nodeAttestor.type` (agent:37), `nodeAttestor.k8s_psat.cluster` (agent:44), `agent.key.type` + `workload.key.type` (consumed in agent configmap:22,36), `server.address` (agent:24), `podLabels.swa_nodegroup` (agent:150). All present.

5. **Risk identification — PASS**
   Evidence: v1's five risks retained; new OQ #6 (line 631) adds audience-claim consistency across the three audience values. OQ #4 (line 629) clarified to distinguish SWA Server PSAT bootstrap (affected by kind JWKS rotation) from workload JWT authenticator (not affected). OQ #3 (line 628) is new and useful — flags the TF JWT authenticator configuration mechanism as a discovery item.

6. **Brand fidelity — PASS**
   Evidence: §10.2 line 391 body stack now `"Helvetica Neue", Helvetica, Arial, -apple-system, sans-serif` with explicit note: *"Helvetica Neue leads (brand-mandated) so macOS does not silently substitute San Francisco via `-apple-system`."* All other §10 tokens, anti-patterns, and component patterns unchanged from v1's PASS.

7. **Implementability — PASS**
   Evidence: revisions added precision (variables.tf default values at line 153-156, configmap inspection at §14.1, TF discovery paths in §7.4 and §16 OQ #1). No new ambiguity introduced. A competent engineer now has a concrete path forward on every previously-blocking item.

8. **Scope discipline — PASS**
   Evidence: §3 non-goals unchanged. No new dependencies added in any §8 / §9 snippet. Milestones M1-M3 (§14) still bounded to single deliverables.

9. **Verification rigor — PASS**
   Evidence: smoketests unchanged in §14.1-14.3 (still concrete `kubectl`/`curl`/headless-browser commands). §14.1 validator focus now includes an explicit configmap RSA verification command — strengthens, not weakens.

10. **Failure-mode coverage — PASS**
    Evidence: §15 failure table unchanged from v1 (still 5 modes with inspector events + user-visible UX).

## Total

**Total: 9 / 10**
**Verdict: PASS (threshold is ≥9)**

## New issues found in this revision

1. **One regression (drives the Criterion 2 FAIL).** §14.2 line 600 still says *"JWT authn signing-key matches kind's JWKS"* — a v1 leftover not updated in lockstep with §6.3. Trivial fix (replace with "JWT authn `jwks-uri` matches SWA's per-trust-domain JWKS at `…/api/swa/trust-domains/idira.demo/.well-known/jwks`, not kind's"), but I am flagging it because (a) it directly contradicts the spec's now-authoritative §6.3 trust-anchor table, and (b) it would mis-guide the M2 validator subagent on the criterion most likely to break the demo.

2. **Audience-coupling framing is slightly stronger than the chart actually requires (non-blocking).** §6.3 line 128 and OQ #6 line 631 imply the SWA Server chart's `controlPlane.auth.audience` and the workload JWT-SVID `aud` claim are technically linked. Verified: `controlPlane.auth.audience` is consumed in `/tmp/swa-server/templates/deployment.yaml:109` only for the **SWA Server's own projected SA token** (the audience the SaaS authn-oidc endpoint validates when the server bootstraps). It is not propagated to workload SVID issuance. The upstream doc (`swa-docs/pages/cjr-authn-jwt-swa.md:94`) does *suggest* keeping all three audience values aligned, and the spec follows the doc's stance — so this is a faithful reading, not a defect. Worth a one-line clarification in OQ #6 that the coupling is conventional, not enforced by the chart.

## Recommendation

**Proceed to `superpowers:writing-plans` after a one-line fix to §14.2 line 600.** The spec is otherwise complete and correct; the regression is mechanical and obvious once pointed out. The author can either (a) accept the 9/10 PASS and fix line 600 as the first task of the M2 builder team, or (b) make the one-line edit and resubmit for a clean 10/10 — either is defensible. I would not block writing-plans on this revision; the v1→v2 delta resolved all six material findings and the lone regression is a one-token search-and-replace.

## Non-blocking nits (carried + new)

- §10.2 body stack now leads with Helvetica Neue — v1 nit fully addressed.
- §6.1 helper output now explicitly documented as "already base64-encoded, no decoding by caller" (line 118) — v1 nit fully addressed.
- §7.1 variables.tf now lists default values inline (lines 153-156) — v1 nit fully addressed.
- §13.2 still references `https://code.claude.com/docs/en/agent-teams` and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` — carried forward from v1; worth confirming these names remain current in the harness before M1 kicks off.
- New: §6.3 line 144 RSA fallback enum order (`RSA2048` → `rsa-2048` → `RSA-2048`) is fine, but if M1 finds the chart silently accepts an EC string and refuses an RSA string, the builder may need to drop to `--set agent.key.type=...` and inspect the rendered configmap directly via `helm template`. Worth a sentence in §14.1 acknowledging the override may need to land via `--set` rather than values-file if the validator catches a discrepancy.
- New: §14.1 validator-focus command `kubectl ... get cm swa-agent-config -o jsonpath='{.data}'` returns a stringified YAML blob; piping through `| grep RSA2048` would be more ergonomic than jsonpath alone. Mechanical, not material.
