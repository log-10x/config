#!/usr/bin/env bash
#
# Runs the rate regulator cases (cases.py) through the released engine image, twice:
#
#   main    the image as published: its own config and modules
#   fix     the same image with this config checkout and a modules checkout mounted
#   before  the same image with an earlier commit of this config (BEFORE_REF) and the
#           modules checkout mounted, to compare a change against the code it replaces
#
# A case is a gate when it fails on main and passes on the fix. Nothing here runs in CI.
#
#   MODULES_DIR=../modules tests/regulator/run.sh            every case, both arms
#   MODULES_DIR=../modules tests/regulator/run.sh k1-errors  some cases
#
# Environment:
#   MODULES_DIR  modules checkout to mount for the fix arm (required)
#   CONFIG_DIR   config checkout to mount for the fix arm (default: this one)
#   IMAGE        engine image (default: edge-10x 1.1.145, by digest)
#   OUT          output folder (default: a new temporary folder)
#   ARMS         arms to run (default: "main fix"; add "before" with BEFORE_REF)
#   BEFORE_REF   config commit for the before arm, extracted with git archive
#   PORT         host port for the paced cases' Forward input (default: 24298)

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$(cd "${CONFIG_DIR:-$HERE/../..}" && pwd)"
: "${MODULES_DIR:?set MODULES_DIR to a modules checkout}"
MODULES_DIR="$(cd "$MODULES_DIR" && pwd)"
IMAGE="${IMAGE:-log10x/edge-10x:1.1.145@sha256:aec232a2f7d9da8277a529ea9d844267f8c6f10bb241f088c1fbe774b8b9949e}"
OUT="${OUT:-$(mktemp -d)}"
ARMS="${ARMS:-main fix}"
PORT="${PORT:-24298}"
CASES=("$@")
[ ${#CASES[@]} -gt 0 ] || mapfile -t CASES < <(python3 -I "$HERE/cases.py" list)

docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE" >/dev/null
BEFORE_DIR=""
if [[ " $ARMS " == *" before "* ]]; then
  : "${BEFORE_REF:?set BEFORE_REF for the before arm}"
  BEFORE_DIR="$OUT/before-config"
  rm -rf "$BEFORE_DIR"; mkdir -p "$BEFORE_DIR"
  git -C "$CONFIG_DIR" archive "$BEFORE_REF" | tar -x -C "$BEFORE_DIR"
  echo "before $BEFORE_REF"
fi
echo "image $IMAGE"
echo "config $CONFIG_DIR ($(git -C "$CONFIG_DIR" rev-parse --short HEAD))"
echo "modules $MODULES_DIR ($(git -C "$MODULES_DIR" rev-parse --short HEAD))"
echo "out $OUT"

run_arm() {
  local name="$1" arm="$2" dir="$OUT/$1/$2"
  rm -rf "$dir"; mkdir -p "$dir"
  python3 -I "$HERE/cases.py" prepare "$name" "$dir"
  local variant; variant="$(cat "$dir/config")"
  if [ "$arm" != fix ] && [ -n "$variant" ]; then echo "n/a" > "$dir/exit"; return; fi
  touch "$dir"/policy/* 2>/dev/null || true
  local envs=(-e INPUT_FILE=/in/events.log -e OUTPUT_DIR=/out)
  while IFS= read -r e; do [ -n "$e" ] && envs+=(-e "$e"); done < "$dir/env"
  local vols=(-v "$dir/events.log":/in/events.log:ro -v "$dir":/out -v "$dir/policy":/policy:ro
              -v "$HERE/replay.yaml":/cfg/replay.yaml:ro)
  if [ "$arm" = before ]; then
    vols+=(-v "$BEFORE_DIR":/etc/tenx/config:ro -v "$MODULES_DIR":/opt/tenx-edge/lib/app/modules:ro)
  fi
  if [ "$arm" = fix ]; then
    vols+=(-v "$CONFIG_DIR":/etc/tenx/config:ro -v "$MODULES_DIR":/opt/tenx-edge/lib/app/modules:ro)
    if [ "$variant" = no-keepcounts ]; then
      python3 -I - "$CONFIG_DIR/pipelines/run/receive/rate/config.yaml" "$dir/rate-config.yaml" <<'PY'
import re, sys
src, out = sys.argv[1:3]
t = open(src).read()
t2 = re.sub(r"\n  keepCounts:\n(    - .*\n)+", "\n", t)
assert t2 != t, "keepCounts block not found"
open(out, "w").write(t2)
PY
      vols+=(-v "$dir/rate-config.yaml":/etc/tenx/config/pipelines/run/receive/rate/config.yaml:ro)
    fi
  fi
  local args=()
  while IFS= read -r a; do [ -n "$a" ] && args+=("$a"); done < "$dir/args"
  if [ -s "$dir/pace" ]; then run_paced "$name-$arm" "$dir" envs vols args; return; fi
  set +e
  docker run --rm "${envs[@]}" "${vols[@]}" "$IMAGE" @/cfg/replay.yaml ${args[@]+"${args[@]}"} > "$dir/engine.log" 2>&1
  echo $? > "$dir/exit"
  set -e
}

# A paced case: the engine runs on paced.yaml (the Forward input) and cases.py sends the
# batches. The exit file says 0 once the pipeline started.
run_paced() {
  local cname="tenx-regulator-$1" dir="$2"
  local -n p_envs="$3" p_vols="$4" p_args="$5"
  docker rm -f "$cname" >/dev/null 2>&1 || true
  docker run -d --name "$cname" -p "127.0.0.1:$PORT:24224" "${p_envs[@]}" "${p_vols[@]}" \
    -v "$HERE/paced.yaml":/cfg/paced.yaml:ro "$IMAGE" @/cfg/paced.yaml ${p_args[@]+"${p_args[@]}"} >/dev/null
  local t=0
  until docker logs "$cname" 2>&1 | grep -q "pipeline units:"; do
    if [ "$t" -ge 120 ] || ! docker ps -q -f "name=^$cname$" | grep -q .; then
      docker logs "$cname" > "$dir/engine.log" 2>&1; docker rm -f "$cname" >/dev/null 2>&1
      echo 1 > "$dir/exit"; return
    fi
    sleep 2; t=$((t + 2))
  done
  sleep 3
  python3 -I "$HERE/cases.py" send "$dir" "$PORT" | sed 's/^/  /'
  sleep 8
  docker stop -t 20 "$cname" >/dev/null
  docker logs "$cname" > "$dir/engine.log" 2>&1
  docker rm "$cname" >/dev/null
  echo 0 > "$dir/exit"
}

summary=()
for name in "${CASES[@]}"; do
  echo
  echo "=== $name"
  verdict=()
  for arm in $ARMS; do
    run_arm "$name" "$arm"
    if [ "$(cat "$OUT/$name/$arm/exit")" = "n/a" ]; then
      echo "  $arm: n/a (fix-only case)"; verdict+=("$arm=n/a"); continue
    fi
    if out="$(python3 -I "$HERE/cases.py" check "$name" "$OUT/$name/$arm")"; then r=PASS; else r=FAIL; fi
    echo "  $arm: $out"
    verdict+=("$arm=$r")
  done
  summary+=("$name ${verdict[*]}")
done

echo
echo "=== summary (a gate holds when main=FAIL, or before=FAIL, and fix=PASS)"
printf '  %s\n' "${summary[@]}"
