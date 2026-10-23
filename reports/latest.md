# Rows run: 2026-10-23T16:23:31.000Z

Rows written: 5280 of 25k an hour last hour (25k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 6060 an hour, with 0 an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 5340 pass lines an hour against 5280 rows the meter puts on it, so each statement's rate is scaled by 1.00. The table holds 3249 active rows.
- The Receiver's statements send 6060 lines an hour, under the 25k an hour that fits the rate; every statement keeps its lines, with room to grow 2.0 times.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 2895 lines an hour whatever the limits; the rate holds down to that floor.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| opentelemetry-collector | the account's bucket | 1 | 6060 | 12k | 152 | 808 |
| `*` (any other service) | the account's bucket | 1 | | 18k | 1229 | 1229 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
