#!/usr/bin/env bash
#
# Live check of the GitHub policy lane: the engine pulls log10x/policy/*.csv from a real
# branch, the regulator caps and totals from the pulled files, and a change pushed to the
# branch reaches the regulator at the next sync. Runs twice, like run.sh:
#
#   main  the image's own config and modules (one github lane, test/*.csv only)
#   fix   this config checkout and a modules checkout mounted
#
#   GH_TOKEN="$(gh auth token)" GH_REPO=owner/repo GH_BRANCH=test/gh-policy-lane \
#   POLICY_CHECKOUT=<a checkout of that branch> MODULES_DIR=../modules tests/regulator/gitops-live.sh
#
# The script pushes two commits to GH_BRANCH (policy v1, then v2); use a throwaway branch and
# delete it afterwards. GH_TOKEN is passed to the container by name only and scrubbed from the
# saved engine log. Nothing here runs in CI.
#
# Environment: GH_TOKEN, GH_REPO, GH_BRANCH, POLICY_CHECKOUT, MODULES_DIR (required);
#   IMAGE, OUT, ARMS (default "main fix"), PORT (default 24299), SYNC_WAIT (default 300 s)

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$(cd "${CONFIG_DIR:-$HERE/../..}" && pwd)"
: "${GH_TOKEN:?}" "${GH_REPO:?}" "${GH_BRANCH:?}" "${POLICY_CHECKOUT:?}" "${MODULES_DIR:?}"
export GH_TOKEN GH_REPO GH_BRANCH
MODULES_DIR="$(cd "$MODULES_DIR" && pwd)"
IMAGE="${IMAGE:-log10x/edge-10x:1.1.145@sha256:aec232a2f7d9da8277a529ea9d844267f8c6f10bb241f088c1fbe774b8b9949e}"
OUT="${OUT:-$(mktemp -d)}"
ARMS="${ARMS:-main fix}"
PORT="${PORT:-24299}"
SYNC_WAIT="${SYNC_WAIT:-300}"
MIRROR=/tmp/tenx/github/log10x/policy/caps.csv
CASE="python3 -I $HERE/live_case.py"

push_policy() {
  local version="$1"
  $CASE policy "$POLICY_CHECKOUT" "$version" > /dev/null
  git -C "$POLICY_CHECKOUT" add log10x test
  git -C "$POLICY_CHECKOUT" diff --cached --quiet || git -C "$POLICY_CHECKOUT" commit -q -m "policy $version for the live lane check"
  git -C "$POLICY_CHECKOUT" push -q origin "HEAD:$GH_BRANCH"
  echo "  pushed policy $version ($(git -C "$POLICY_CHECKOUT" rev-parse --short HEAD))"
}

wait_log() {
  local name="$1" pattern="$2" secs="$3" t=0
  while [ "$t" -lt "$secs" ]; do
    docker logs "$name" 2>&1 | grep -q "$pattern" && return 0
    docker ps -q -f "name=^$name$" | grep -q . || return 1
    sleep 2; t=$((t + 2))
  done
  return 1
}

run_arm() {
  local arm="$1" dir="$OUT/$1" name="tenx-gh-live-$1"
  rm -rf "$dir"; mkdir -p "$dir"
  echo "=== $arm"
  push_policy v1
  docker rm -f "$name" > /dev/null 2>&1
  local vols=(-v "$dir":/out -v "$HERE/live.yaml":/cfg/live.yaml:ro)
  [ "$arm" = fix ] && vols+=(-v "$CONFIG_DIR":/etc/tenx/config:ro -v "$MODULES_DIR":/opt/tenx-edge/lib/app/modules:ro)
  docker run -d --name "$name" -p "127.0.0.1:$PORT:24224" -e GH_ENABLED=true -e GH_REPO -e GH_BRANCH -e GH_TOKEN \
    -e OUTPUT_DIR=/out "${vols[@]}" "$IMAGE" @/cfg/live.yaml rateReceiverWarmupMs 0 > /dev/null
  if ! wait_log "$name" "pipeline units:" 120; then
    docker logs "$name" > "$dir/engine.log" 2>&1; docker rm -f "$name" > /dev/null 2>&1
    sed -i.bak "s/$GH_TOKEN/<redacted>/g" "$dir/engine.log"; rm -f "$dir/engine.log.bak"
    echo "FAIL live-$arm: no pipeline: $(grep -m1 -E 'could not|Exception' "$dir/engine.log" | cut -c1-160)"
    return 1
  fi
  [ "$arm" = fix ] && echo "  mirrored caps.csv at start: $(docker exec "$name" cat "$MIRROR" | tr '\n' ' ')"
  sleep 3
  $CASE send "$PORT" A | sed 's/^/  /'
  sleep 10
  local want; want="$($CASE policy "$POLICY_CHECKOUT" v2)"
  push_policy v2
  if [ "$arm" = fix ]; then
    local t0=$SECONDS
    until docker exec "$name" cat "$MIRROR" 2>/dev/null | grep -qx "$want"; do
      [ $((SECONDS - t0)) -lt "$SYNC_WAIT" ] || { echo "  v2 not mirrored within ${SYNC_WAIT}s"; break; }
      sleep 5
    done
    echo "  v2 mirrored after $((SECONDS - t0))s: $(docker exec "$name" cat "$MIRROR" | tr '\n' ' ')"
  fi
  sleep 10
  $CASE send "$PORT" B | sed 's/^/  /'
  sleep 12
  docker stop -t 20 "$name" > /dev/null
  docker logs "$name" > "$dir/engine.log" 2>&1
  docker rm "$name" > /dev/null
  sed -i.bak "s/$GH_TOKEN/<redacted>/g" "$dir/engine.log"; rm -f "$dir/engine.log.bak"
  grep -c "<redacted>" "$dir/engine.log" | sed 's/^/  token occurrences scrubbed from the log: /'
  $CASE check "$dir/routed.jsonl" "$arm" | sed 's/^/  /'
}

echo "image $IMAGE; repo $GH_REPO@$GH_BRANCH; out $OUT"
rc=0
for arm in $ARMS; do run_arm "$arm" || rc=1; done
exit $rc
