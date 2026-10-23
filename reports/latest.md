# Rows run: 2026-10-23T16:30:33.000Z

Rows written: 26k of 25k an hour last hour (25k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 25k an hour, with 93k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 25k pass lines an hour against 26k rows the meter puts on it, so each statement's rate is scaled by 1.04. The table holds 7455 active rows.
- The Receiver's statements send 118k lines an hour; 25k an hour fits the rate, so each statement keeps up to 891 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 4860 lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| ad | the account's bucket | 1 | 6044 | 1969 | 59 | 131 |
| cart | the account's bucket | 1 | 13k | 1782 | 59 | 118 |
| fluentd-10x | the account's bucket | 1 | 935 | 891 | 59 | 59 |
| frontend | the account's bucket | 1 | 1309 | 891 | 59 | 59 |
| grafana | the account's bucket | 1 | 685 | 685 | 59 | 45 |
| inventory | the account's bucket | 1 | 7665 | 891 | 59 | 59 |
| jaeger | the account's bucket | 1 | 810 | 810 | 59 | 54 |
| kafka | the account's bucket | 1 | 17k | 12k | 59 | 766 |
| opensearch | the account's bucket | 1 | 187 | 187 | 59 | 12 |
| opentelemetry-collector | the account's bucket | 1 | 67k | 3564 | 59 | 237 |
| prometheus-server | the account's bucket | 1 | 125 | 125 | 59 | 8 |
| recommendation | the account's bucket | 1 | 2181 | 891 | 59 | 59 |
| valkey-cart | the account's bucket | 1 | 312 | 312 | 59 | 20 |
| `*` (any other service) | the account's bucket | 1 | | 891 | 59 | 59 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
