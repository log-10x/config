#!/usr/bin/env bash
#
# Launch check: starts the engine image on the install lines a Receiver uses and requires a
# constructed pipeline ("pipeline units:") with no "could not launch". The forwarder inputs
# wait for connections, so each launch is stopped after LAUNCH_SECONDS.
#
#   MODULES_DIR=../modules tests/regulator/launch.sh
#
# Environment:
#   MODULES_DIR     modules checkout mounted with this config checkout (required)
#   IMAGE           engine image (default: edge-10x 1.1.145, by digest)
#   LAUNCH_SECONDS  how long each launch runs before it is stopped (default: 45)
#   MOUNT           "fix" mounts the checkouts (default); "main" runs the image's own files

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$(cd "$HERE/../.." && pwd)"
: "${MODULES_DIR:?set MODULES_DIR to a modules checkout}"
MODULES_DIR="$(cd "$MODULES_DIR" && pwd)"
IMAGE="${IMAGE:-log10x/edge-10x:1.1.145@sha256:aec232a2f7d9da8277a529ea9d844267f8c6f10bb241f088c1fbe774b8b9949e}"
SECS="${LAUNCH_SECONDS:-45}"
MOUNT="${MOUNT:-fix}"
WORK="$(mktemp -d)"
mkdir -p "$WORK/policy" "$WORK/output"
printf 'container,cap\ncheckout,4000\n*,2000\n' > "$WORK/policy/caps.csv"
printf 'container,action\ncheckout,offload\n*,tier_down\n' > "$WORK/policy/actions.csv"
printf 'container,total\n*,20000\n' > "$WORK/policy/totals.csv"

# The options log10x-mcp writes on a Datadog Receiver with a fleet default
# (src/lib/fleet-default-install.ts), then the three regulator options of 1.1.146.
MCP=(symbolMessageHashField tenx_hash
     rateReceiverAbsoluteCap 25960 rateReceiverDefaultAction tier_down
     rateReceiverMinSharePercent 0 rateReceiverWarmupMs 0 rateReceiverBaselineCount 5
     rateReceiverMinRetentionThreshold 0
     rateReceiverSeverityFloors TRACE=0 rateReceiverSeverityFloors DEBUG=0 rateReceiverSeverityFloors INFO=0
     rateReceiverSeverityFloors WARN=0 rateReceiverSeverityFloors ERROR=0
     rateReceiverSeverityFloors CRITICAL=0 rateReceiverSeverityFloors FATAL=0)
NEW=(rateReceiverUnit events
     rateReceiverKeepCounts ERROR=50 rateReceiverKeepCounts CRITICAL=50 rateReceiverKeepCounts FATAL=50
     rateReceiverTotalLookupFile /policy/totals.csv)

launch() {
  local label="$1"; shift
  local envs=(-e outputOffload=true -e CAP_LOOKUP_FILE=/policy/caps.csv -e ACTION_LOOKUP_FILE=/policy/actions.csv)
  local vols=(-v "$WORK/policy":/policy:ro)
  # @apps/dev writes into data/sample/output, so that folder gets a scratch mount.
  [ "$MOUNT" = fix ] && vols+=(-v "$CONFIG_DIR":/etc/tenx/config:ro -v "$MODULES_DIR":/opt/tenx-edge/lib/app/modules:ro
                               -v "$WORK/output":/etc/tenx/config/data/sample/output)
  while [ "$1" != "--" ]; do envs+=(-e "$1"); shift; done; shift
  touch "$WORK"/policy/*
  local out
  out="$(timeout "$SECS" docker run --rm "${envs[@]}" "${vols[@]}" "$IMAGE" "$@" 2>&1 | head -2000)"
  local why
  why="$(echo "$out" | grep -m1 -E "could not launch|Unknown options|could not parse|must be")"
  if echo "$out" | grep -q "could not launch pipeline" || ! echo "$out" | grep -q "pipeline units:"; then
    echo "FAIL  $label: ${why:-no 'pipeline units:' within ${SECS}s}"
    return 1
  fi
  echo "OK    $label: $(echo "$out" | grep -m1 -o 'pipeline units:.*' | cut -c1-80)"
}

echo "image $IMAGE ($MOUNT)"
rc=0
launch "fluentbit receiver, MCP Datadog options + unit/keepCounts/totals" -- @run/input/forwarder/fluentbit @apps/receiver "${MCP[@]}" "${NEW[@]}" || rc=1
launch "fluentbit receiver, same + soft-drop" outputSoftDrop=true -- @run/input/forwarder/fluentbit @apps/receiver "${MCP[@]}" "${NEW[@]}" || rc=1
launch "fluentd receiver, MCP Datadog options + unit/keepCounts/totals" -- @run/input/forwarder/fluentd @apps/receiver "${MCP[@]}" "${NEW[@]}" || rc=1
launch "fluentbit receiver, MCP Datadog options only" -- @run/input/forwarder/fluentbit @apps/receiver "${MCP[@]}" || rc=1
launch "@apps/dev" -- @apps/dev || rc=1
rm -rf "$WORK"
exit $rc
