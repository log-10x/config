# Rows run: 2026-10-23T16:29:29.000Z

Rows written: 30k of 25k an hour last hour (25k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 25k an hour, with 106k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 25k pass lines an hour against 30k rows the meter puts on it, so each statement's rate is scaled by 1.19. The table holds 7031 active rows.
- The Receiver's statements send 131k lines an hour; 25k an hour fits the rate, so each statement keeps up to 908 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 4244 lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| ad | the account's bucket | 1 | 7011 | 2244 | 60 | 149 |
| cart | the account's bucket | 1 | 12k | 1815 | 60 | 121 |
| fluentd-10x | the account's bucket | 1 | 1002 | 908 | 60 | 60 |
| frontend | the account's bucket | 1 | 858 | 858 | 60 | 57 |
| grafana | the account's bucket | 1 | 787 | 787 | 60 | 52 |
| inventory | the account's bucket | 1 | 8370 | 908 | 60 | 60 |
| kafka | the account's bucket | 1 | 23k | 12k | 60 | 786 |
| opensearch | the account's bucket | 1 | 72 | 72 | 60 | 4 |
| opentelemetry-collector | the account's bucket | 1 | 74k | 3630 | 60 | 242 |
| prometheus-server | the account's bucket | 1 | 215 | 215 | 60 | 14 |
| recommendation | the account's bucket | 1 | 2289 | 908 | 60 | 60 |
| valkey-cart | the account's bucket | 1 | 358 | 358 | 60 | 23 |
| `*` (any other service) | the account's bucket | 1 | | 908 | 60 | 60 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
