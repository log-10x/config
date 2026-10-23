# Rows run: 2026-10-23T16:28:30.000Z

Rows written: 20k of 25k an hour last hour (25k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 25k an hour, with 96k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 22k pass lines an hour against 20k rows the meter puts on it, so each statement's rate is scaled by 1.00. The table holds 6495 active rows.
- The Receiver's statements send 120k lines an hour; 25k an hour fits the rate, so each statement keeps up to 965 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 4935 lines an hour whatever the limits; the rate holds down to that floor.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| ad | the account's bucket | 1 | 3840 | 1930 | 64 | 128 |
| cart | the account's bucket | 1 | 12k | 1930 | 64 | 128 |
| fluentd-10x | the account's bucket | 1 | 780 | 780 | 64 | 52 |
| frontend | the account's bucket | 1 | 1680 | 965 | 64 | 64 |
| frontend-proxy | the account's bucket | 1 | 60 | 60 | 64 | 4 |
| grafana | the account's bucket | 1 | 26k | 1265 | 64 | 84 |
| inventory | the account's bucket | 1 | 7380 | 965 | 64 | 64 |
| kafka | the account's bucket | 1 | 13k | 11k | 64 | 753 |
| opensearch | the account's bucket | 1 | 180 | 180 | 64 | 12 |
| opentelemetry-collector | the account's bucket | 1 | 53k | 3860 | 64 | 257 |
| recommendation | the account's bucket | 1 | 1920 | 965 | 64 | 64 |
| valkey-cart | the account's bucket | 1 | 300 | 300 | 64 | 20 |
| `*` (any other service) | the account's bucket | 1 | | 965 | 64 | 64 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
