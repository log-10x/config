# Rows run: 2026-10-25T01:48:09.000Z

Rows written: 2580 of 31k an hour last hour (31k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 27k an hour, with 0 an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 2280 pass lines an hour against 2580 rows the meter puts on it, so each statement's rate is scaled by 1.13. The table holds 9279 active rows.
- The Receiver's statements send 27k lines an hour, under the 31k an hour that fits the rate; every statement keeps its lines, with room to grow 1.2 times.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 3301 lines an hour whatever the limits; the rate holds down to that floor.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| ad | the account's bucket | 1 | 815 | 943 | 31 | 62 |
| cart | the account's bucket | 1 | 4006 | 4636 | 209 | 309 |
| fluentd-10x | the account's bucket | 1 | 204 | 236 | 15 | 15 |
| frontend | the account's bucket | 1 | 1086 | 1257 | 36 | 83 |
| grafana | the account's bucket | 1 | 68 | 79 | 5 | 5 |
| inventory | the account's bucket | 1 | 1833 | 2121 | 141 | 141 |
| kafka | the account's bucket | 1 | 3598 | 4164 | 31 | 277 |
| opentelemetry-collector | the account's bucket | 1 | 15k | 17k | 471 | 1126 |
| recommendation | the account's bucket | 1 | 407 | 471 | 31 | 31 |
| `*` (any other service) | the account's bucket | 1 | | 4184 | 278 | 278 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
