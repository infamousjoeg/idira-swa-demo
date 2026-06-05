#!/usr/bin/env bash
# setup.sh -- guided interactive prereq onboarding for the SWA demo.
# Six phases: greet/arch, tools, .envrc, re-exec, conceal, verify.

set -euo pipefail

# ---- flags --------------------------------------------------------------
ASSUME_YES=0
PRINT_ONLY=0
SKIP_TOOLS=0
SKIP_ENVRC=0
SKIP_CONCEAL=0

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
phase3_envrc()            { (( SKIP_ENVRC ))   && return 0; echo '[phase 3 stub] .envrc'; }
phase4_reexec()           { (( SKIP_ENVRC ))   && return 0; echo '[phase 4 stub] re-exec'; }
phase5_conceal()          { (( SKIP_CONCEAL )) && return 0; echo '[phase 5 stub] conceal'; }
phase6_verify()           { echo '[phase 6 stub] verify'; }

main() {
  phase1_greet_and_arch
  phase2_tools
  phase3_envrc
  phase4_reexec
  phase5_conceal
  phase6_verify
}

main "$@"
