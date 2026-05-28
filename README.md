# Idira SWA Demo

A Mac-laptop demo of Palo Alto Networks' **Idira Secure Workload Access (SWA)**:
a workload fetches a real secret from CyberArk Secrets Manager – SaaS using a
SPIFFE JWT-SVID minted in-cluster — no static credentials in the workload, no
agent token on disk. The UI splits left/right so you can watch the SPIFFE
plumbing as you click.

## What you see

Open `http://localhost:8080` after `make up && make portforward`:

- **Left** — Praetor Logistics shipment-lookup portal (the consumer surface).
- **Right** — Idira inspector. Live trace of every hop: mTLS handshake, JWT-SVID
  issuance, SM authn-jwt exchange, secret fetch, fixture lookup.

Click **RESOLVE SECRET** and the inspector fills in within ~200 ms.

## Prerequisites

- macOS Apple Silicon
- `docker`, `kind`, `kubectl`, `helm`, `terraform`, `jq`, `curl`, `envsubst`,
  `summon`, `conceal` on PATH
- `node` ≥ 18 (for the M3 headless Playwright smoke)
- `swa-release-1.0.4/` bundle in this directory (gitignored vendor drop)
- A Secrets Manager – SaaS tenant. Copy `.envrc.example` to `.envrc` and set
  `PANW_SM_TENANT` (your SM SaaS subdomain) and `CONCEAL_NAMESPACE` (the
  Keychain path holding your CyberArk Service User credentials). **No secrets
  in `.envrc`** — Service User credentials live in the macOS Keychain via
  Conceal at `${CONCEAL_NAMESPACE}/client_id` and
  `${CONCEAL_NAMESPACE}/client_secret`, and are injected into tenant-touching
  commands via `summon -p conceal_summon` (see spec §6.1).
- `make doctor` enforces the above.

## Quick start

```bash
cp .envrc.example .envrc && vim .envrc      # set PANW_SM_TENANT + CONCEAL_NAMESPACE
conceal set "$CONCEAL_NAMESPACE/client_id"     <your-service-user-login>
conceal set "$CONCEAL_NAMESPACE/client_secret" <your-service-user-api-key>
direnv allow                                 # or source .envrc
make doctor                                  # verify prerequisites
make up                                      # full deploy + headless smoke (~4 min)
make portforward                             # serve portal on http://localhost:8080
# ... demo away ...
make down                                    # tear everything down (cluster + tenant TF state)
```

## Milestone breakdown

| Make target   | What it does |
|---|---|
| `make up-m1`  | kind + SWA platform up (server + agent healthy, SPIFFE hierarchy on tenant) |
| `make up-m2`  | + carrier service + JWT authn + policy + secret |
| `make up`     | + portal UI + headless smoke |

| Smoke target  | What it asserts |
|---|---|
| `make smoke-m1` | server/agent healthy; RSA workload key override in effect |
| `make smoke-m2` | carrier resolves a shipment via JWT-SVID end-to-end; error paths work |
| `make smoke-m3` | full click sequence drives 6 expected event types within 3s; brand asserts |
| `make smoke`    | all three above |

## Token TTL

Identity OAuth tokens are ≤15 min; SM access tokens are ~8 min. Every Make
target that touches the tenant re-fetches a fresh token via
`scripts/get-sm-token.sh` (wrapped in `summon -p conceal_summon`). For manual
`terraform` runs, source `eval "$(make tf-token)"` first. `make down` retries
TF destroy up to 3 times with a fresh token per attempt so a token expiry mid-
destroy doesn't strand state.

## Design

`docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md` — full spec.
`docs/superpowers/plans/2026-05-27-idira-swa-demo-m{1,2,3}-*.md` — implementation plans.

## Brand and visual constraints

The UI is hand-built vanilla HTML/CSS/JS (no React, no Tailwind, no shadcn) to
hold the brand line. See spec §10. CI-style asserts in
`ui-tests/smoke.spec.ts` reject emoji, purple/pink gradients, and shadcn class
markers anywhere in the rendered DOM. The reference screenshot at
`out/m3-portal-empty.png` is the by-eye baseline the validator compares against.
