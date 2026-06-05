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
phase2_tools()            { (( SKIP_TOOLS ))   && return 0; echo '[phase 2 stub] tools'; }
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
