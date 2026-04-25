#!/bin/bash
#
# Capture a fresh snapshot of the live retriever demo env into this directory.
# Run this against the live cluster BEFORE decommissioning it, or any time
# you want to refresh the reference data here.
#
# Requires: aws cli (authenticated), kubectl (ctx pointing at the demo EKS),
#           helm, gzip, python3.
#
# Writes:
#   manifests/        — helm / deploys / cronjobs / hpa / configmap / sqs attrs
#   schema-samples/   — byte-range index JSON, reverse index JSON, _DONE.json,
#                       bloom-filter key listing (first 20), byte-count marker
#                       key listing (first 20)
#   snapshots/        — first 1 MB of a raw app log file (gzipped), first 2 KB
#                       plaintext sample of the same
#
# Does NOT capture (too big for repo):
#   - Full raw log files (~21 MB each; 1000s of them)
#   - Full bloom-filter key set (thousands of keys per time bucket)
#   - Template library t/merged_*  (~4 MB)
#
# For bigger captures, edit the script or use `aws s3 sync` directly.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MANIFESTS="$HERE/manifests"
SCHEMAS="$HERE/schema-samples"
SNAPSHOTS="$HERE/snapshots"

BUCKET="${RETRIEVER_BUCKET:-tenx-demo-cloud-retriever-351939435334}"
NAMESPACE="${RETRIEVER_NAMESPACE:-demo}"
RELEASE="${RETRIEVER_HELM_RELEASE:-tenx-retriever}"
TARGET_PREFIX="${RETRIEVER_TARGET:-app}"   # main log app prefix under the bucket

mkdir -p "$MANIFESTS" "$SCHEMAS" "$SNAPSHOTS"

echo "=== manifests ==="
helm -n "$NAMESPACE" get manifest "$RELEASE" \
    > "$MANIFESTS/retriever-helm-manifest.yaml"
kubectl -n "$NAMESPACE" get deploy -o yaml \
    > "$MANIFESTS/retriever-deployments.yaml"
kubectl -n "$NAMESPACE" get cronjob -o yaml \
    > "$MANIFESTS/retriever-cronjobs.yaml"
kubectl -n "$NAMESPACE" get hpa -o yaml \
    > "$MANIFESTS/retriever-hpa.yaml"
kubectl -n "$NAMESPACE" get configmap -o yaml \
    > "$MANIFESTS/retriever-configmap.yaml"

echo "=== sqs queues ==="
python3 - <<PY
import json, subprocess, os
r = subprocess.run(
    ['aws','sqs','list-queues','--queue-name-prefix',
     '${BUCKET%%-[0-9]*}-'.replace('${BUCKET%%-[0-9]*}','tenx-demo-cloud-retriever'),
     '--output','json'], capture_output=True, text=True, check=True)
urls = json.loads(r.stdout).get('QueueUrls', [])
out = {}
for u in urls:
    name = u.rsplit('/', 1)[-1]
    a = subprocess.run(
        ['aws','sqs','get-queue-attributes','--queue-url',u,
         '--attribute-names','All','--output','json'],
        capture_output=True, text=True, check=True)
    attrs = json.loads(a.stdout).get('Attributes', {})
    attrs['_url'] = u
    out[name] = attrs
with open(os.path.join('$MANIFESTS', 'sqs-queues.json'), 'w') as f:
    json.dump(out, f, indent=2, sort_keys=True)
print(f'{len(out)} queues')
PY

echo "=== redact known secret shapes in manifests ==="
# GitHub PATs are leaked as plain env values via the cron jobs; scrub them
# before this directory goes anywhere the repo goes.
for f in "$MANIFESTS"/*.yaml; do
    [ -e "$f" ] || continue
    sed -i.bak -E \
        -e 's/(value: github_pat_)[A-Za-z0-9_]+/\1REDACTED/g' \
        -e 's/(value: ghp_)[A-Za-z0-9_]+/\1REDACTED/g' \
        "$f"
    rm "$f.bak"
done

echo "=== schema samples ==="
# Byte-range index (per-blob)
BR_KEY="$(aws s3api list-objects-v2 --bucket "$BUCKET" \
    --prefix "indexing-results/tenx/$TARGET_PREFIX/b/" \
    --max-keys 1 --query 'Contents[0].Key' --output text)"
if [ "$BR_KEY" != "None" ] && [ -n "$BR_KEY" ]; then
    aws s3 cp "s3://$BUCKET/$BR_KEY" "$SCHEMAS/byte-range-index.json" --quiet
fi

# Reverse index (per source object)
RI_KEY="$(aws s3api list-objects-v2 --bucket "$BUCKET" \
    --prefix "indexing-results/tenx/$TARGET_PREFIX/r/" \
    --max-keys 1 --query 'Contents[0].Key' --output text)"
if [ "$RI_KEY" != "None" ] && [ -n "$RI_KEY" ]; then
    aws s3 cp "s3://$BUCKET/$RI_KEY" "$SCHEMAS/reverse-index.json" --quiet
fi

# _DONE.json marker (R21)
DONE_KEY="$(aws s3api list-objects-v2 --bucket "$BUCKET" \
    --prefix "indexing-results/tenx/$TARGET_PREFIX/qr/" \
    --max-keys 5 \
    --query 'Contents[?contains(Key, `_DONE`)].Key | [0]' --output text)"
if [ "$DONE_KEY" != "None" ] && [ -n "$DONE_KEY" ]; then
    aws s3 cp "s3://$BUCKET/$DONE_KEY" "$SCHEMAS/done-marker-sample.json" --quiet
fi

# Bloom-filter key listing (paths only; files are 0-byte)
aws s3 ls "s3://$BUCKET/indexing-results/$TARGET_PREFIX/" --recursive 2>&1 \
    | head -20 > "$SCHEMAS/bloom-filter-key-listing.sample.txt"

# Byte-count marker key listing (q/ paths; numeric values embedded in keys)
aws s3api list-objects-v2 --bucket "$BUCKET" \
    --prefix "indexing-results/tenx/$TARGET_PREFIX/q/" \
    --max-keys 20 --query 'Contents[*].{Key:Key,Size:Size}' \
    --output text > "$SCHEMAS/byte-count-marker-listing.sample.txt"

echo "=== raw log sample (first 1 MB, gzipped) ==="
RAW_KEY="$(aws s3api list-objects-v2 --bucket "$BUCKET" \
    --prefix "$TARGET_PREFIX/" --max-keys 1 \
    --query 'Contents[0].Key' --output text)"
if [ "$RAW_KEY" != "None" ] && [ -n "$RAW_KEY" ]; then
    aws s3 cp "s3://$BUCKET/$RAW_KEY" - 2>/dev/null \
        | head -c 1048576 | gzip -9 \
        > "$SNAPSHOTS/raw-log-sample-head-1mb.gz" || true
    aws s3 cp "s3://$BUCKET/$RAW_KEY" - 2>/dev/null \
        | head -c 2048 \
        > "$SNAPSHOTS/raw-log-first-2kb.jsonl-sample.txt" || true
fi

echo "=== done ==="
ls -la "$MANIFESTS" "$SCHEMAS" "$SNAPSHOTS"
