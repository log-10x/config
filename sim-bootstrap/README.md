# Retriever simulation bootstrap

Captured reference material for building a simulated retriever environment
that can serve the demo experience without the full EKS cluster (AWS bill).

Companion to the working `backend/lambdas/demo-metrics-replay` lambda —
that one handles Prometheus metrics. This directory covers everything
else the retriever exposes (S3 archive, index schemas, SQS flow, CW
structured logs, helm/k8s topology).

## Contents

```
.
├── capture.sh                           # Re-run to refresh from live env
├── manifests/
│   ├── retriever-helm-manifest.yaml      # helm get manifest tenx-retriever
│   ├── retriever-deployments.yaml        # kubectl get deploy
│   ├── retriever-cronjobs.yaml           # 5 retriever CronJobs + index-inducer
│   ├── retriever-hpa.yaml                # chart + manual HPAs
│   ├── retriever-configmap.yaml          # fluent-bit config + scheduledQueries
│   ├── sqs-queues.json                  # 4 queues + 4 DLQs, attributes
│   └── sqs-queues-list.json             # raw ListQueues output
├── schema-samples/
│   ├── byte-range-index.json            # one b/{targetHash} — per-blob time
│   │                                    # ranges for scan dispatch
│   ├── reverse-index.json               # one r/{sourceObject} — path listing
│   │                                    # for a source file
│   ├── done-marker-sample.json          # one qr/{qid}/_DONE.json from R21
│   ├── bloom-filter-key-listing.sample.txt
│   │                                    # first 20 bloom-filter S3 keys
│   └── byte-count-marker-listing.sample.txt
│                                        # first 20 q/{qid}/{utf8bytes}
└── snapshots/
    ├── raw-log-sample-head-1mb.gz       # first 1 MB of one app/*.log, gzipped
    └── raw-log-first-2kb.jsonl-sample.txt
                                         # first 2 KB, plaintext, for quick
                                         # eyeballing of the JSONL shape
```

Secrets (GitHub PATs, API keys) are redacted from manifests in place
via `sed` during `capture.sh`. Nothing here needs further redaction
before committing or sharing.

## What the live cluster exposes — the surface the sim must match

### REST entry
- `POST http://{elb}/retriever/query` — JSON body: `{id, name, from, to, search, filters, writeResults, processingTime, resultSize, logLevels}`. Returns `{queryId}`. See `log10x-mcp/src/lib/retriever-api.ts` for the full request shape.
- `GET http://{elb}/retriever/query/{qid}/status` — returns `{queryId, logGroup, logStreamPrefix, resultsBucket, resultsPrefix, summary:{queryStarted, queryComplete, streamDispatch, streamWorkerComplete, streamWorkerSkipped, resultsWriterComplete, eventsWrittenTotal, stackOverflowError}, state}`. State transitions: `not_found → running → partially_complete → complete | complete_no_events | deadline_exceeded | crashed`. See `l1x-inc/pipeline/run-quarkus/src/main/java/com/log10x/ext/quarkus/endpoints/app/retriever/RetrieverQueryStatus.java` for the exact impl (post-v16: backed by `DescribeLogStreams` + `GetLogEvents`, not Insights).
- `GET http://{elb}/q/health` — Quarkus health (Kubernetes liveness/readiness). Responds `200` with a JSON payload containing `pipeline-executor-capacity`.

### S3 layout
All paths are under `{bucket}/indexing-results/`:
```
app/{epoch_bucket_ms}/{targetHash}/{byteRangeIndex}/{encodedBloomFilterBytes}
                                                    └─ 0-byte S3 object;
                                                       the filename IS the
                                                       bloom filter's bit
                                                       representation
tenx/{target}/b/{targetHash}              JSON — per-blob byte-range index
tenx/{target}/r/{sourceObjectPath}        JSON — reverse index for a file
tenx/{target}/q/{qid}/{targetHash}/{utf8_byte_count}
                                          0-byte S3 object; value encoded
                                          in the filename. Written by
                                          stream-worker on close. Coordinator
                                          sums these to check queryLimitResultSize.
tenx/{target}/qr/{qid}/_DONE.json         R21 — coordinator completion marker
tenx/{target}/qr/{qid}/{objectByteRangesKey}.jsonl
                                          Per-worker matching events (only
                                          when writeResults=true)
tenx/{target}/qr/{qid}/{objectByteRangesKey}.truncated
                                          Sentinel written when a worker
                                          hits its per-worker event cap
tenx/{target}/t/merged_{epochMs}_{hash}   Merged template library from the
                                          tokenizer (several MB; not
                                          captured here due to size)
```

Plus the raw log input path, which is simply `{bucket}/{targetPrefix}/...`
(e.g. `{bucket}/app/otel-sample-2026-04-20-15-47.log`). New files here
trigger S3-event → SQS index-queue → indexer pod → writes the above
index artifacts.

### SQS queues
- `tenx-demo-cloud-retriever-index-queue` — raw-log-file-added events from S3, consumed by indexer pods.
- `tenx-demo-cloud-retriever-query-queue` — query submissions from scheduled CronJobs (cluster-internal source).
- `tenx-demo-cloud-retriever-subquery-queue` — coordinator-dispatched scan sub-queries to query-handler pods. Trace context rides on `MessageAttributes.traceparent`.
- `tenx-demo-cloud-retriever-stream-queue` — scan-dispatched stream requests to stream-worker pods. Trace context on MessageAttributes.
- Each has a `-dlq` sibling (14 d retention, redrive `maxReceiveCount=3`).

All attribute details (receive-wait-time, visibility-timeout, DLQ redrive
policy, depth-at-capture-time) in `manifests/sqs-queues.json`.

### CloudWatch
- **Log group**: `/tenx/demo-retriever/query` — all query-side pods write
  structured JSON here. The R18 `/status` endpoint reads it directly via
  `DescribeLogStreams` + `GetLogEvents`. Emits marker substrings: `query started:`, `query complete:`, `stream dispatch:`, `stream worker complete:`, `stream worker skipped:`, `results writer complete: N events`, `StackOverflowError`. All messages include a `data` JSON block with `queryId`, `traceparent`, etc.
- **Metrics**: `Log10x/Retriever` namespace — 8 filter-derived metrics
  (`StackOverflowCount`, `ScanCompleteCount`, `WorkerCompleteCount`,
  `ResultsWriterCompleteCount`, `ScannedBlobsCount`, `MatchedBlobsCount`,
  `LaunchFailedCount`, `WorkerSkippedCount`). See `backend/terraform/demo/retriever-observability.tf`.
- **Alarms**: 3 on retriever metrics + 4 on DLQ depth.
- **Dashboard**: `tenx-demo-retriever`.

## Minimum viable sim (design notes)

1. **One S3 bucket** (small; a few GB total) with the layout above.
2. **One lambda + one schedule**: every minute, copy `{bucket}/app/otel-sample-...log` → `{bucket}/app/otel-sample-{now}.log`, REWRITING the per-event timestamps inside the JSONL payload to `now - {original-offset}`. If you don't rewrite event timestamps inside the file, queries over `now-1h` return empty-range (exact bug the demo's own cron-inducer hits when it stalls).
3. **One mini-retriever pod** (not EKS) running the standard retriever image (`dev-obs-v16`). Connect to the simulated bucket + 4 SQS queues + CW log group. Scales linearly with S3 write volume.
4. **One ALB/NLB or ngrok** exposing the retriever's `POST /retriever/query` + `GET /retriever/query/{qid}/status`.
5. **`demo-metrics-replay` lambda** continues as-is for Grafana dashboards.

What you DO NOT need to reproduce:
- The 4 node-group EKS setup — one pod per role on one cheap VM is fine.
- HPA — fixed single replica per role.
- Fluent-bit sidecar — single pod can write to CW directly via agent or kinesis-firehose.

Expected cost: ~$20–40/mo (one EC2 + minor S3 + minor SQS) vs. ~$240/mo for the full demo EKS.

## How to use this bootstrap

**To rebuild the sim from scratch:**
1. Read `manifests/retriever-helm-manifest.yaml` — shows the full container spec (env vars, probes, volumes) the retriever pods need. Boil it down to a single `docker run` or a 3-service compose.
2. Read `manifests/retriever-configmap.yaml` scheduledQueries block — the 5 CronJob queries the demo runs for dashboards. Replicate as either cron-on-the-sim-host, or a lambda.
3. Read `schema-samples/` to understand the S3 index formats the retriever will produce in the sim (useful for assertions / verifying the mini-retriever indexed correctly).
4. Use `snapshots/raw-log-sample-head-1mb.gz` as the seed replay data.
5. Follow the mini-sim design notes above.

**To refresh the captures:**
```
./capture.sh
```
Run against the live demo cluster (kubectl ctx + aws creds). Rewrites the
captures in place. Safe to re-run — all `sed` redaction is idempotent.

## Known gaps

- Template library (`t/merged_*`) not captured here — ~4 MB, too big for
  the repo. `capture.sh` can be extended to pull a gzipped snapshot of
  it if the sim ever needs bloom-filter generation from scratch.
- Bloom filter key listing is truncated to the first 20 keys (there are
  thousands per time bucket). The 20 samples are enough to infer the
  pattern but the full corpus would be needed for a high-fidelity replay.
- `CloudWatch log group contents` — not captured. For a sim, the mini-
  retriever will generate its own CW logs live, so a historical snapshot
  isn't needed. If you want historical context, use
  `aws logs create-export-task` against `/tenx/demo-retriever/query`.
- No prometheus metrics snapshot here — `backend/lambdas/demo-metrics-replay`
  already owns that.

## Related

- **Retriever handoff deep guide**: `~/.claude/projects/-Users-talweiss-eclipse-workspace-l1x-co-config/memory/project_retriever_handoff_guide.md` — architecture + verified facts + fix catalog + perf measurements.
- **Test harnesses**: `log10x-mcp` branch `test/retriever-harnesses` (PR #42) — 15 live-deploy harnesses that exercise every surface documented here.
- **Metrics replay**: `backend/lambdas/demo-metrics-replay/` — working template for the sim's lambda pattern.
