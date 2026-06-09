#!/usr/bin/env bash
# doctor.sh -- verify M1 prerequisites. Exits 0 iff every check passes.
set -euo pipefail

fail=0

check_cmd() {
  local cmd=$1 hint=$2
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf '  [MISSING] %-12s -- %s\n' "$cmd" "$hint"
    fail=$((fail+1))
  else
    printf '  [ok]      %-12s\n' "$cmd"
  fi
}

check_path() {
  local path=$1 hint=$2
  if [[ ! -e "$path" ]]; then
    printf '  [MISSING] %-30s -- %s\n' "$path" "$hint"
    fail=$((fail+1))
  else
    printf '  [ok]      %-30s\n' "$path"
  fi
}

check_arch() {
  local arch
  arch=$(uname -m)
  if [[ "$arch" != "arm64" ]]; then
    printf '  [WRONG]   uname -m == %s -- this demo targets Apple Silicon (arm64)\n' "$arch"
    fail=$((fail+1))
  else
    printf '  [ok]      apple-silicon (%s)\n' "$arch"
  fi
}

echo 'Tools:'
check_cmd docker     'install Docker Desktop or colima'
check_cmd kind       'brew install kind'
check_cmd kubectl    'brew install kubectl'
check_cmd helm       'brew install helm'
check_cmd terraform  'brew install terraform'
check_cmd jq         'brew install jq'
check_cmd curl       'macOS ships curl; check PATH'
check_cmd envsubst   'brew install gettext && brew link --force gettext'
check_cmd summon     'brew install summon'
check_cmd conceal    'brew install cyberark/tools/conceal'

echo
echo 'Host:'
check_arch

echo
echo 'Release bundle:'
# Resolve the TGZ filename via env (override-friendly) with the canonical
# default. This intentionally does NOT participate in the env-var loop below
# -- the loop fails on empty values, and this variable is legitimately
# defaultable.
tgz="${SWA_RELEASE_TGZ:-swa-release-v1.0.0.tgz}"
if [[ ! -f "$tgz" ]]; then
  printf '  [MISSING] %-30s -- drop the SWA release tarball at repo root\n' "$tgz"
  fail=$((fail+1))
else
  printf '  [ok]      %-30s\n' "$tgz"
  # Verify .swa-release/ is in lockstep with the source TGZ via the marker
  # file written by scripts/unpack-release.sh.
  mark='.swa-release/.tgz-source'
  want_sha=$(shasum -a 256 "$tgz" | awk '{print $1}')
  want="tgz=$(basename "$tgz")"$'\n'"sha256=$want_sha"
  if [[ ! -f "$mark" ]]; then
    printf '  [MISSING] %-30s -- run `make unpack`\n' '.swa-release/ (unpacked)'
    fail=$((fail+1))
  elif [[ "$(cat "$mark")" != "$want" ]]; then
    printf '  [STALE]   %-30s -- TGZ changed; run `make unpack`\n' '.swa-release/'
    fail=$((fail+1))
  else
    printf '  [ok]      %-30s\n' '.swa-release/ (matches TGZ)'
    check_path '.swa-release/container-images'                  'image tarballs'
    check_path '.swa-release/helm/swa-server-0.1.0.tgz'         'server chart'
    check_path '.swa-release/helm/swa-agent-0.1.0.tgz'          'agent chart'
    check_path '.swa-release/install-terraform-provider.sh'     'provider installer'
  fi
fi
# Friendly warning if a legacy 1.0.4 folder is still hanging around.
if [[ -d swa-release-1.0.4 ]]; then
  printf '  [warn]    legacy swa-release-1.0.4/ folder present -- run `make migrate-from-1.0.4`\n'
fi

echo
echo 'Non-secret env:'
# Inspect the *inherited* env only. Self-sourcing .envrc would mask the
# real problem: if the caller's shell hasn't loaded it (via direnv or
# `source .envrc`), the Makefile won't see the vars either, and `make up`
# would fail at the first `_check-env` recipe with a confusing message.
for v in PANW_SM_TENANT CONCEAL_NAMESPACE; do
  if [[ -z "${!v:-}" ]]; then
    if [[ -f .envrc ]]; then
      printf '  [MISSING] $%s -- .envrc exists but is not loaded into this shell; run `direnv allow` or `source .envrc`\n' "$v"
    else
      printf '  [MISSING] $%s -- copy .envrc.example to .envrc, fill in values, then `direnv allow` or `source .envrc`\n' "$v"
    fi
    fail=$((fail+1))
  else
    printf '  [ok]      $%s=%s\n' "$v" "${!v}"
  fi
done

echo
echo 'Secrets (macOS Keychain via Conceal):'
if [[ -n "${CONCEAL_NAMESPACE:-}" ]]; then
  for key in client_id client_secret; do
    path="${CONCEAL_NAMESPACE}/${key}"
    if conceal get "$path" >/dev/null 2>&1; then
      printf '  [ok]      conceal:%s\n' "$path"
    else
      printf '  [MISSING] conceal:%s -- run `conceal set %s <value>`\n' "$path" "$path"
      fail=$((fail+1))
    fi
  done
else
  printf '  [skip]    CONCEAL_NAMESPACE not set -- cannot check keychain paths\n'
fi

echo
echo 'Tenant reachability (Platform Discovery):'
if [[ -n "${PANW_SM_TENANT:-}" ]]; then
  if curl -fsSL --max-time 5 \
       "https://platform-discovery.cyberark.cloud/api/v2/services/subdomain/${PANW_SM_TENANT}" \
       | jq -er '.identity_administration.api' >/dev/null 2>&1; then
    printf '  [ok]      platform-discovery resolves Identity URL for %s\n' "$PANW_SM_TENANT"
  else
    printf '  [FAIL]    platform-discovery cannot resolve Identity URL for %s\n' "$PANW_SM_TENANT"
    fail=$((fail+1))
  fi
else
  printf '  [skip]    PANW_SM_TENANT not set -- cannot probe discovery\n'
fi

echo
if (( fail == 0 )); then
  echo 'All prerequisites satisfied.'
  exit 0
else
  echo "Doctor found $fail issue(s). Resolve them before continuing M1."
  exit 1
fi
