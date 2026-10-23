# Rows run: 2026-10-23T16:31:32.000Z

Rows written: 17k of 25k an hour last hour (25k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 25k an hour, with 80k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 18k pass lines an hour against 17k rows the meter puts on it, so each statement's rate is scaled by 1.00. The table holds 7570 active rows.
- The Receiver's statements send 104k lines an hour; 25k an hour fits the rate, so each statement keeps up to 941 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 4005 lines an hour whatever the limits; the rate holds down to that floor.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| ad | the account's bucket | 1 | 4320 | 2122 | 62 | 141 |
| cart | the account's bucket | 1 | 14k | 1882 | 62 | 125 |
| fluentd-10x | the account's bucket | 1 | 780 | 780 | 62 | 52 |
| frontend | the account's bucket | 1 | 1560 | 941 | 62 | 62 |
| grafana | the account's bucket | 1 | 480 | 480 | 62 | 32 |
| inventory | the account's bucket | 1 | 7020 | 941 | 62 | 62 |
| kafka | the account's bucket | 1 | 18k | 12k | 62 | 815 |
| opensearch | the account's bucket | 1 | 60 | 60 | 62 | 4 |
| opentelemetry-collector | the account's bucket | 1 | 56k | 3763 | 62 | 250 |
| prometheus-server | the account's bucket | 1 | 60 | 60 | 62 | 4 |
| recommendation | the account's bucket | 1 | 1560 | 941 | 62 | 62 |
| valkey-cart | the account's bucket | 1 | 300 | 300 | 62 | 20 |
| `*` (any other service) | the account's bucket | 1 | | 941 | 62 | 62 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
