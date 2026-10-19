#!/usr/bin/env bash
#
# Runs the rate regulator cases (cases.py) through the released engine image, twice:
#
#   main  the image as published: its own config and modules
#   fix   the same image with this config checkout and a modules checkout mounted
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
#   ARMS         arms to run (default: "main fix")

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$(cd "${CONFIG_DIR:-$HERE/../..}" && pwd)"
: "${MODULES_DIR:?set MODULES_DIR to a modules checkout}"
MODULES_DIR="$(cd "$MODULES_DIR" && pwd)"
IMAGE="${IMAGE:-log10x/edge-10x:1.1.145@sha256:aec232a2f7d9da8277a529ea9d844267f8c6f10bb241f088c1fbe774b8b9949e}"
OUT="${OUT:-$(mktemp -d)}"
ARMS="${ARMS:-main fix}"
CASES=("$@")
[ ${#CASES[@]} -gt 0 ] || mapfile -t CASES < <(python3 -I "$HERE/cases.py" list)

docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE" >/dev/null
echo "image $IMAGE"
echo "config $CONFIG_DIR ($(git -C "$CONFIG_DIR" rev-parse --short HEAD))"
echo "modules $MODULES_DIR ($(git -C "$MODULES_DIR" rev-parse --short HEAD))"
echo "out $OUT"

run_arm() {
  local name="$1" arm="$2" dir="$OUT/$1/$2"
  rm -rf "$dir"; mkdir -p "$dir"
  python3 -I "$HERE/cases.py" prepare "$name" "$dir"
  local variant; variant="$(cat "$dir/config")"
  if [ "$arm" = main ] && [ -n "$variant" ]; then echo "n/a" > "$dir/exit"; return; fi
  touch "$dir"/policy/* 2>/dev/null || true
  local envs=(-e INPUT_FILE=/in/events.log -e OUTPUT_DIR=/out)
  while IFS= read -r e; do [ -n "$e" ] && envs+=(-e "$e"); done < "$dir/env"
  local vols=(-v "$dir/events.log":/in/events.log:ro -v "$dir":/out -v "$dir/policy":/policy:ro
              -v "$HERE/replay.yaml":/cfg/replay.yaml:ro)
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
  set +e
  docker run --rm "${envs[@]}" "${vols[@]}" "$IMAGE" @/cfg/replay.yaml ${args[@]+"${args[@]}"} > "$dir/engine.log" 2>&1
  echo $? > "$dir/exit"
  set -e
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
echo "=== summary (a gate holds when main=FAIL and fix=PASS)"
printf '  %s\n' "${summary[@]}"
