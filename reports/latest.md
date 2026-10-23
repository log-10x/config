# Rows run: 2026-10-23T16:21:33.000Z

Rows written: 9300 of 25k an hour last hour (25k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 12k an hour, with 0 an hour of lines to the account's bucket.

- Outside the Receiver: 8292 rows an hour (the meter less the Receiver's 1008 pass lines). The table holds 3001 active rows.
- The Receiver's statements send 3828 lines an hour, under the 16k an hour that fits the rate; every statement keeps its lines, with room to grow 2.0 times.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 450 lines an hour whatever the limits; the rate holds down to that floor.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| kafka | the account's bucket | 1 | 3828 | 7657 | 94 | 510 |
| `*` (any other service) | the account's bucket | 1 | | 12k | 825 | 825 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
