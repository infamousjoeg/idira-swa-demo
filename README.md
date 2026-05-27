# Idira SWA Demo

A Mac-laptop demo of Palo Alto Networks' **Idira Secure Workload Access (SWA)**:
a real workload fetches a real secret from CyberArk Secrets Manager – SaaS using
a SPIFFE JWT-SVID minted in-cluster — no static credentials in the workload, no
agent token on disk.

## Prerequisites

- macOS Apple Silicon
- `docker`, `kind`, `kubectl`, `helm`, `terraform`, `jq`, `curl`, `envsubst`,
  `summon`, `conceal` on PATH
- `swa-release-1.0.4/` bundle in this directory (gitignored vendor drop)
- A Secrets Manager – SaaS tenant. Copy `.envrc.example` to `.envrc` and set
  `PANW_SM_TENANT`. **No secrets in `.envrc`** — Service User credentials live
  in the macOS Keychain via Conceal at
  `infamousdev/claudecode/client_id|secret` and are injected into
  tenant-touching commands via `summon -p conceal_summon` (see spec §6.1).

## Quick start

```bash
cp .envrc.example .envrc && vim .envrc      # set PANW_SM_TENANT
make doctor                                  # verify prerequisites
make up                                      # full deploy (~3 min)
make portforward                             # serve portal on http://localhost:8080
make down                                    # tear everything down
```

## Token TTL

Identity OAuth tokens are ≤15 min. SM access tokens are ~8 min. Every Make
target that touches the tenant re-fetches a fresh token via
`scripts/get-sm-token.sh` (wrapped in `summon -p conceal_summon`). For manual
`terraform` runs, source `eval "$(make tf-token)"` first.

## Design

See `docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md`.
