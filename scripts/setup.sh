#!/usr/bin/env bash
# setup.sh -- guided interactive prereq onboarding for the SWA demo.
# Six phases: greet/arch, tools, .envrc, re-exec, conceal, verify.

set -euo pipefail

# Sentinel: set to 1 on the second pass after phase 4 re-execs us under the
# freshly-sourced .envrc. Defaulted here so `(( ... ))` reads survive `set -u`.
: "${SWA_SETUP_REEXECED:=0}"

# ---- flags --------------------------------------------------------------
ASSUME_YES=0
PRINT_ONLY=0
SKIP_TOOLS=0
SKIP_ENVRC=0
SKIP_CONCEAL=0

# Snapshot original argv before the parser eats them, so phase 4's
# `exec "$0" "${ORIG_ARGS[@]}"` re-execs with the user's flags intact.
# Unconditional `=()` so `set -u` survives when invoked with no args.
ORIG_ARGS=()
if (( $# > 0 )); then
  ORIG_ARGS=("$@")
fi

usage() {
  cat <<'EOF'
Usage: make setup [-- FLAGS]
       ./scripts/setup.sh [FLAGS]

Guided onboarding: install missing tools via Homebrew (with consent),
build .envrc from .envrc.example, store Service User credentials in the
macOS Keychain via `conceal set`, then run `make doctor` to verify.

Flags:
  -y, --yes          Assume "yes" for every install prompt. Secrets
                     capture still runs interactively (conceal needs it).
  --print-only       Never invoke `brew install` or `conceal set`; print
                     the exact command that would run, then continue.
  --skip-tools       Skip phase 2 (tool walkthrough).
  --skip-envrc       Skip phase 3 (.envrc walkthrough) and phase 4 re-exec.
  --skip-conceal     Skip phase 5 (conceal walkthrough).
  -h, --help         Show this message and exit.
EOF
}

while (( $# > 0 )); do
  case "$1" in
    -y|--yes)       ASSUME_YES=1 ;;
    --print-only)   PRINT_ONLY=1 ;;
    --skip-tools)   SKIP_TOOLS=1 ;;
    --skip-envrc)   SKIP_ENVRC=1 ;;
    --skip-conceal) SKIP_CONCEAL=1 ;;
    -h|--help)      usage; exit 0 ;;
    *)              printf 'unknown flag: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# ---- color/tty helpers --------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'
  C_DIM=$'\033[2m'
  C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
else
  C_RESET='' C_DIM='' C_BOLD='' C_RED='' C_GREEN='' C_YELLOW=''
fi

header()    { printf '\n%s== %s ==%s\n' "$C_BOLD" "$1" "$C_RESET"; }
ok()        { printf '  %s[ok]%s        %s\n' "$C_GREEN" "$C_RESET" "$1"; }
miss()      { printf '  %s[MISSING]%s   %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
fail()      { printf '  %s[FAIL]%s      %s\n' "$C_RED" "$C_RESET" "$1"; }
note()      { printf '  %s\n' "$1"; }

# ---- prompt helpers -----------------------------------------------------
# confirm "prompt text" [default] -> returns 0 on yes, 1 on no.
# default is "Y" or "N" (case-insensitive); empty input takes the default.
# Respects --yes (always returns 0). Uses tr for uppercase to stay
# compatible with bash 3.2 (macOS /bin/bash), which lacks ${var^^}.
confirm() {
  local prompt=$1 default=${2:-Y} ans
  if (( ASSUME_YES )); then
    printf '%s [auto-Y]\n' "$prompt"
    return 0
  fi
  local default_upper
  default_upper=$(printf '%s' "$default" | tr '[:lower:]' '[:upper:]')
  local hint='[Y/n]'
  [[ "$default_upper" == N ]] && hint='[y/N]'
  read -r -p "$prompt $hint " ans
  ans=${ans:-$default}
  local ans_upper
  ans_upper=$(printf '%s' "$ans" | tr '[:lower:]' '[:upper:]')
  [[ "$ans_upper" == Y* ]]
}

# ---- shared state -------------------------------------------------------
# Track skipped/failed tools for the final summary in phase 6. Initialized
# unconditionally so `(( ${#FOO[@]} ))` reads in later phases survive `set -u`.
SKIPPED_TOOLS=()
FAILED_TOOLS=()

# ---- phases (stubs; filled in by later tasks) ---------------------------
phase1_greet_and_arch() {
  # ANSI Shadow figlet rendering of "SWA". Subtitle dimmed in a tty.
  cat <<EOF

███████╗██╗    ██╗ █████╗
██╔════╝██║    ██║██╔══██╗
███████╗██║ █╗ ██║███████║
╚════██║██║███╗██║██╔══██║
███████║╚███╔███╔╝██║  ██║
╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝
EOF
  printf '%s        Secure Workload Access%s\n\n' "$C_DIM" "$C_RESET"

  cat <<'EOF'
This script walks you through installing the demo's prerequisites and
wiring up your local environment. It will:
  - Ask before installing any tool via Homebrew.
  - Build a .envrc from .envrc.example (no secrets).
  - Invoke `conceal set` so you can store your CyberArk Service User
    credentials in the macOS Keychain. Conceal prompts you for those
    directly; this script never sees them.

It will not touch your SM tenant or run any deploy step.

EOF

  header 'Phase 1: host check'
  local arch
  arch=$(uname -m)
  if [[ "$arch" != "arm64" ]]; then
    fail "uname -m == $arch -- this demo targets Apple Silicon (arm64)"
    exit 1
  fi
  ok "apple-silicon ($arch)"
}
phase2_tools() {
  (( SKIP_TOOLS )) && return 0
  header 'Phase 2: tools'

  if ! command -v brew >/dev/null 2>&1; then
    fail "Homebrew is not installed. Install it first:"
    note '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    note '  See https://brew.sh for details. Then re-run `make setup`.'
    exit 1
  fi

  # Registry: name | install-cmd (empty for docker -- print-only) | blurb
  # The blurb prints when the tool is MISSING so the user understands what
  # they are about to install.
  local docker_blurb='Docker Desktop, OrbStack, and colima all work. Install one and re-run setup.'
  local kind_blurb='Runs a local Kubernetes cluster inside Docker.'
  local kubectl_blurb='Kubernetes CLI.'
  local helm_blurb='Installs the SWA Server and Agent charts.'
  local terraform_blurb='Configures the SPIFFE hierarchy and Conjur policy on the tenant.'
  local jq_blurb='JSON parsing used throughout the deploy scripts.'
  local envsubst_blurb='Templating used by the carrier ConfigMap render. Bundled with GNU gettext on macOS.'
  local summon_blurb='CyberArk'\''s secret-injector. Every tenant-touching command in this demo is run as `summon -p conceal_summon -- <cmd>`, which fetches your Service User credentials from Keychain and injects them as env vars for that one subprocess. They never land on disk, never appear in `ps`, and never leak into shell history.'
  local conceal_blurb='CyberArk'\''s Keychain wrapper. We use it to store your Service User client_id and client_secret in the macOS Keychain under a namespace you choose. Summon then reads from there at runtime via the `conceal_summon` provider. You will set the values yourself in a moment -- this script never sees them.'

  check_tool docker    ''                                                  "$docker_blurb"
  check_tool kind      'brew install kind'                                 "$kind_blurb"
  check_tool kubectl   'brew install kubectl'                              "$kubectl_blurb"
  check_tool helm      'brew install helm'                                 "$helm_blurb"
  check_tool terraform 'brew install terraform'                            "$terraform_blurb"
  check_tool jq        'brew install jq'                                   "$jq_blurb"
  check_tool envsubst  'brew install gettext && brew link --force gettext' "$envsubst_blurb"
  check_tool summon    'brew install summon'                               "$summon_blurb"
  check_tool conceal   'brew install cyberark/tools/conceal'               "$conceal_blurb"
}

# check_tool <name> <install-cmd-or-empty> <blurb>
check_tool() {
  local name=$1 install_cmd=$2 blurb=$3
  if command -v "$name" >/dev/null 2>&1; then
    ok "$name"
    return 0
  fi
  miss "$name"
  printf '    %s%s%s\n' "$C_DIM" "$blurb" "$C_RESET"

  if [[ -z "$install_cmd" ]]; then
    # Docker case: no auto-install. Record as skipped and continue.
    note '    (no auto-install -- install one of Docker Desktop, OrbStack, or colima, then re-run)'
    SKIPPED_TOOLS+=("$name")
    return 0
  fi

  if ! confirm "    Install via '$install_cmd'?" Y; then
    SKIPPED_TOOLS+=("$name")
    note "    [skipped] $name"
    return 0
  fi

  if (( PRINT_ONLY )); then
    printf '    [print-only] would run: %s\n' "$install_cmd"
    return 0
  fi

  if eval "$install_cmd"; then
    if command -v "$name" >/dev/null 2>&1; then
      ok "$name installed"
    else
      fail "$name -- brew reported success but command is still missing"
      FAILED_TOOLS+=("$name")
    fi
  else
    fail "$name -- brew install exited non-zero"
    FAILED_TOOLS+=("$name")
  fi
}
phase3_envrc() {
  (( SKIP_ENVRC )) && return 0
  header 'Phase 3: .envrc'

  if [[ ! -f .envrc.example ]]; then
    fail '.envrc.example not found -- run setup from the repo root'
    exit 1
  fi

  local exists=0 has_placeholders=0
  if [[ -f .envrc ]]; then
    exists=1
    if grep -q '<your-' .envrc; then
      has_placeholders=1
    fi
  fi

  if (( exists )) && (( ! has_placeholders )); then
    ok '.envrc exists and looks populated'
    return 0
  fi

  if (( exists )) && (( has_placeholders )); then
    miss '.envrc exists but still contains placeholder strings (e.g. <your-subdomain>)'
    if ! confirm '    Overwrite .envrc with fresh values?' N; then
      note '    [skipped] .envrc -- leaving in place'
      return 0
    fi
  else
    note '.envrc not found -- creating from .envrc.example'
  fi

  # Prompt for values.
  local tenant ns_default ns
  read -r -p '    PANW_SM_TENANT (your SM SaaS subdomain, e.g. "acme"): ' tenant
  if [[ -z "$tenant" ]]; then
    fail 'PANW_SM_TENANT is required'
    exit 1
  fi
  ns_default="${tenant}/swa-demo"
  read -r -p "    CONCEAL_NAMESPACE [${ns_default}]: " ns
  ns=${ns:-$ns_default}

  if (( PRINT_ONLY )); then
    printf '    [print-only] would write .envrc with PANW_SM_TENANT=%s CONCEAL_NAMESPACE=%s\n' "$tenant" "$ns"
    return 0
  fi

  # Atomic write: .envrc.tmp -> .envrc.
  sed -e "s|<your-subdomain>|${tenant}|" \
      -e "s|<your-keychain-namespace>|${ns}|" \
      .envrc.example > .envrc.tmp
  mv .envrc.tmp .envrc
  ok ".envrc written (PANW_SM_TENANT=${tenant}, CONCEAL_NAMESPACE=${ns})"
  note '    If you use direnv, run `direnv allow` in another shell. I will'
  note '    re-exec myself so phase 5 sees the new env.'
}
phase4_reexec() {
  (( SKIP_ENVRC )) && return 0
  # If .envrc was missing earlier and the user picked print-only or skipped,
  # there is nothing to source. Detect and bail quietly.
  if [[ ! -f .envrc ]]; then
    note '    (no .envrc on disk -- skipping re-exec; phase 5 will degrade)'
    return 0
  fi
  # If we already re-execed, do not loop.
  if (( SWA_SETUP_REEXECED )); then
    return 0
  fi
  # shellcheck disable=SC1091
  set +u; source ./.envrc; set -u
  export SWA_SETUP_REEXECED=1
  # Re-exec with the original argv so user flags (--skip-conceal,
  # --print-only, --yes, ...) persist into the second pass. Guard the
  # expansion so `set -u` survives when ORIG_ARGS is empty.
  if (( ${#ORIG_ARGS[@]} > 0 )); then
    exec "$0" "${ORIG_ARGS[@]}"
  else
    exec "$0"
  fi
}
phase5_conceal() {
  (( SKIP_CONCEAL )) && return 0
  header 'Phase 5: conceal (Keychain credentials)'

  if ! command -v conceal >/dev/null 2>&1; then
    miss 'conceal is not installed -- cannot store Keychain credentials'
    note '    Install it (`brew install cyberark/tools/conceal`) then re-run:'
    note '        make setup SETUP_FLAGS="--skip-tools --skip-envrc"'
    SKIPPED_TOOLS+=('conceal-phase')
    return 0
  fi

  if [[ -z "${CONCEAL_NAMESPACE:-}" ]]; then
    miss '$CONCEAL_NAMESPACE is not set -- cannot pick Keychain paths'
    note '    Source .envrc (or run `direnv allow`) then re-run:'
    note '        make setup SETUP_FLAGS="--skip-tools --skip-envrc"'
    SKIPPED_TOOLS+=('conceal-phase')
    return 0
  fi

  local key
  for key in client_id client_secret; do
    conceal_set_one "$key"
  done
}

# conceal_set_one <key>
# Probes the keychain for <CONCEAL_NAMESPACE>/<key>; on hit, offers a default-N
# keep/reset; on miss (or reset), invokes `conceal set <path>` directly so
# conceal handles the masked secret prompt itself. This script never reads,
# stores, or echoes the secret value.
conceal_set_one() {
  local key=$1 path="${CONCEAL_NAMESPACE}/${key}"

  if conceal get "$path" >/dev/null 2>&1; then
    note ''
    if ! confirm "    ${path} is already set in Keychain. Reset it?" N; then
      ok "${key} already stored"
      return 0
    fi
    # fall through to set
  fi

  note ''
  note "    Next, I will run:  conceal set ${path}"
  note '    Conceal will prompt you for the value with masked input.'
  note '    This script never sees what you type.'

  if (( PRINT_ONLY )); then
    printf '    [print-only] would run: conceal set %s\n' "$path"
    return 0
  fi

  # Immediately invoke; no intermediate Y/n prompt (spec phase 5).
  local rc=0
  conceal set "$path" || rc=$?
  if (( rc == 0 )); then
    if conceal get "$path" >/dev/null 2>&1; then
      ok "${key} stored in Keychain"
    else
      fail "${key} -- conceal set returned 0 but get cannot find it"
      FAILED_TOOLS+=("conceal:${key}")
    fi
  else
    fail "${key} -- conceal set exited ${rc}"
    FAILED_TOOLS+=("conceal:${key}")
  fi
}
phase6_verify() {
  header 'Phase 6: verify'
  local rc=0
  ./scripts/doctor.sh || rc=$?

  # Summary of anything we couldn't (or wouldn't) handle. Arrays are
  # unconditionally `=()` at the top of the script, so reads survive `set -u`
  # even when nothing was skipped or failed.
  printf '\n'
  if (( ${#SKIPPED_TOOLS[@]} > 0 )); then
    note "You skipped: ${SKIPPED_TOOLS[*]}"
  fi
  if (( ${#FAILED_TOOLS[@]} > 0 )); then
    printf '  %sFailures during setup: %s%s\n' "$C_RED" "${FAILED_TOOLS[*]}" "$C_RESET"
  fi

  if (( rc == 0 )); then
    printf '\n%sAll set.%s Next steps:\n' "$C_GREEN" "$C_RESET"
    note '  source .envrc          # if direnv is not handling it'
    note '  make up-m1             # deploy SWA against your tenant'
  else
    printf '\n%sDoctor still flagged issues above.%s Address them, then re-run `make doctor`.\n' "$C_YELLOW" "$C_RESET"
  fi
  return "$rc"
}

main() {
  if (( SWA_SETUP_REEXECED == 0 )); then
    phase1_greet_and_arch
    phase2_tools
    phase3_envrc
    phase4_reexec "$@"
  fi
  phase5_conceal
  phase6_verify
}

main "$@"
