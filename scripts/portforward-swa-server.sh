#!/usr/bin/env bash
# portforward-swa-server.sh -- maintain the kubectl port-forward that
# exposes svc/swa-server:8443 on 127.0.0.1:18443 for the macOS swa-agent.
#
# Invoked from com.cyberark.swa-portforward.plist as the LaunchAgent's
# ProgramArgument (via a symlink at ~/.local/bin/swa-portforward-wrapper.sh
# managed by scripts/install-laptop-agent.sh, so the LaunchAgent never
# breaks when the repo moves).
#
# Idempotency contract: if a previous port-forward is still alive (its PID
# from the pid file is reachable via `kill -0`), exit 0 without
# re-launching. Otherwise launch a fresh one, record its PID, and exec
# `wait` so launchd treats this script as long-lived (KeepAlive=true on
# the plist respawns the script on exit; the script in turn keeps
# kubectl as a foreground child).
#
# Binds 127.0.0.1:18443 explicitly (NOT 0.0.0.0:18443). Per spec section
# 11.1 (no wildcard listeners) and rubric criterion 4 (no wildcard
# trust): the port is reachable only from loopback on this laptop.
#
# Refs: spec sections 5.1, 10.7, 11.1. Plan task 1.8.

set -euo pipefail

ns="${SWA_NAMESPACE:-swa-system}"
svc="${SWA_SERVER_SVC:-svc/swa-server}"
addr="${SWA_PORTFORWARD_ADDRESS:-127.0.0.1}"
local_port="${SWA_PORTFORWARD_PORT:-18443}"
remote_port="${SWA_SERVER_PORT:-8443}"

cache_dir="${HOME}/Library/Caches/swa-agent"
log_dir="${HOME}/Library/Logs"
pid_file="${cache_dir}/portforward.pid"
log_file="${log_dir}/swa-portforward.log"

mkdir -p "$cache_dir" "$log_dir"

ts() { date +"%Y-%m-%dT%H:%M:%S%z"; }

log() { printf '[%s] portforward-swa-server: %s\n' "$(ts)" "$*" >> "$log_file"; }

# Step 1: if the pid file points at a live process, leave it alone.
if [ -f "$pid_file" ]; then
  existing_pid=$(cat "$pid_file" 2>/dev/null || true)
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    log "existing port-forward alive at pid ${existing_pid}; no-op"
    # Block so launchd treats this script as the long-lived process
    # (KeepAlive=true respawns the script on exit; if we returned 0,
    # launchd would loop us).
    wait "$existing_pid" 2>/dev/null || true
    exit 0
  fi
  log "stale pid file (pid ${existing_pid:-empty} not alive); removing"
  rm -f "$pid_file"
fi

# Step 2: ensure kubectl is on PATH (LaunchAgent env is minimal). PATH is
# also set in the plist's EnvironmentVariables, but a manual run from
# a shell should still work.
if ! command -v kubectl >/dev/null 2>&1; then
  log "FATAL: kubectl not on PATH (PATH=$PATH)"
  exit 1
fi

log "launching: kubectl port-forward --address ${addr} -n ${ns} ${svc} ${local_port}:${remote_port}"

# Step 3: launch kubectl in foreground and capture its PID. `exec` makes
# kubectl this script's only child so the PID file points at a real
# process the launchd respawn logic can observe.
kubectl port-forward \
  --address "${addr}" \
  -n "${ns}" \
  "${svc}" \
  "${local_port}:${remote_port}" \
  >>"$log_file" 2>&1 &
pid=$!

echo "$pid" > "$pid_file"
log "kubectl port-forward started at pid ${pid} (logs: ${log_file})"

# Step 4: wait for kubectl to exit; remove pid file on exit so the next
# launchd respawn does not see a stale pid.
trap 'rm -f "$pid_file"; log "kubectl exited; pid file cleaned"' EXIT
wait "$pid"
