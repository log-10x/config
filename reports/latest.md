# Rows run: 2026-10-25T01:47:10.000Z

Rows written: 22k of 31k an hour last hour (31k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 31k an hour, with 81k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 23k pass lines an hour against 22k rows the meter puts on it, so each statement's rate is scaled by 1.00. The table holds 9279 active rows.
- The Receiver's statements send 112k lines an hour; 31k an hour fits the rate, so each statement keeps up to 1091 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 5100 lines an hour whatever the limits; the rate holds down to that floor.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| ad | the account's bucket | 1 | 5520 | 2542 | 72 | 169 |
| cart | the account's bucket | 1 | 13k | 3202 | 72 | 213 |
| fluentd-10x | the account's bucket | 1 | 900 | 900 | 72 | 60 |
| frontend | the account's bucket | 1 | 2760 | 2351 | 72 | 156 |
| grafana | the account's bucket | 1 | 600 | 600 | 72 | 40 |
| inventory | the account's bucket | 1 | 7260 | 1091 | 72 | 72 |
| kafka | the account's bucket | 1 | 19k | 14k | 72 | 949 |
| opensearch | the account's bucket | 1 | 120 | 120 | 72 | 8 |
| opentelemetry-collector | the account's bucket | 1 | 60k | 4363 | 72 | 290 |
| recommendation | the account's bucket | 1 | 2340 | 1091 | 72 | 72 |
| valkey-cart | the account's bucket | 1 | 300 | 300 | 72 | 20 |
| `*` (any other service) | the account's bucket | 1 | | 1091 | 72 | 72 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
