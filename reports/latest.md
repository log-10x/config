# Rows run: 2026-10-23T16:20:29.000Z

Rows written: 47k of 25k an hour last hour (25k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 47k an hour, with 0 an hour of lines to the account's bucket.

- Outside the Receiver: 47k rows an hour (the meter less the Receiver's 0 pass lines). The table holds 2552 active rows.
- The Receiver's statements send 0 lines an hour, under the 0 an hour that fits the rate; every statement keeps its lines, with room to grow 2.0 times.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 0 lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.
- Warning: Rows from writers outside the Receiver already reach 47k an hour, at or above the rate, so the Receiver's services keep nothing beyond the always-pass sample.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| `*` (any other service) | the account's bucket | 1 | | 0 | 1 | 1 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
