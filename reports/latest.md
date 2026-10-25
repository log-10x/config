# Rows run: 2026-10-25T01:46:10.000Z

Rows written: 32k of 31k an hour last hour (31k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 31k an hour, with 82k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 32k pass lines an hour against 32k rows the meter puts on it, so each statement's rate is scaled by 1.00. The table holds 8937 active rows.
- The Receiver's statements send 113k lines an hour; 31k an hour fits the rate, so each statement keeps up to 1081 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 5640 lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| ad | the account's bucket | 1 | 4800 | 2462 | 72 | 164 |
| cart | the account's bucket | 1 | 12k | 2762 | 72 | 184 |
| fluentd-10x | the account's bucket | 1 | 840 | 840 | 72 | 56 |
| frontend | the account's bucket | 1 | 1860 | 1681 | 72 | 112 |
| grafana | the account's bucket | 1 | 780 | 780 | 72 | 52 |
| inventory | the account's bucket | 1 | 7020 | 1081 | 72 | 72 |
| jaeger | the account's bucket | 1 | 780 | 780 | 72 | 52 |
| kafka | the account's bucket | 1 | 19k | 14k | 72 | 940 |
| opensearch | the account's bucket | 1 | 180 | 180 | 72 | 12 |
| opentelemetry-collector | the account's bucket | 1 | 63k | 4323 | 72 | 288 |
| prometheus-server | the account's bucket | 1 | 120 | 120 | 72 | 8 |
| recommendation | the account's bucket | 1 | 1800 | 1081 | 72 | 72 |
| valkey-cart | the account's bucket | 1 | 600 | 600 | 72 | 40 |
| `*` (any other service) | the account's bucket | 1 | | 1081 | 72 | 72 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
