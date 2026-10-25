# Rows run: 2026-10-25T01:44:09.000Z

Rows written: 20k of 31k an hour last hour (31k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 31k an hour, with 87k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 22k pass lines an hour against 20k rows the meter puts on it, so each statement's rate is scaled by 1.00. The table holds 7581 active rows.
- The Receiver's statements send 118k lines an hour; 31k an hour fits the rate, so each statement keeps up to 1086 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 5715 lines an hour whatever the limits; the rate holds down to that floor.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| ad | the account's bucket | 1 | 4680 | 2351 | 72 | 156 |
| cart | the account's bucket | 1 | 11k | 2891 | 72 | 192 |
| fluentd-10x | the account's bucket | 1 | 840 | 840 | 72 | 56 |
| frontend | the account's bucket | 1 | 1740 | 1566 | 72 | 104 |
| frontend-proxy | the account's bucket | 1 | 60 | 60 | 72 | 4 |
| grafana | the account's bucket | 1 | 8460 | 1686 | 72 | 112 |
| inventory | the account's bucket | 1 | 7080 | 1086 | 72 | 72 |
| kafka | the account's bucket | 1 | 20k | 14k | 72 | 952 |
| opensearch | the account's bucket | 1 | 180 | 180 | 72 | 12 |
| opentelemetry-collector | the account's bucket | 1 | 62k | 4342 | 72 | 289 |
| prometheus-server | the account's bucket | 1 | 120 | 120 | 72 | 8 |
| recommendation | the account's bucket | 1 | 1800 | 1086 | 72 | 72 |
| valkey-cart | the account's bucket | 1 | 300 | 300 | 72 | 20 |
| `*` (any other service) | the account's bucket | 1 | | 1086 | 72 | 72 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
