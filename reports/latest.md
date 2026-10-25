# Rows run: 2026-10-25T01:36:10.000Z

Rows written: 50k of 31k an hour last hour (31k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 31k an hour, with 19k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 12k pass lines an hour against 50k rows the meter puts on it, so each statement's rate is scaled by 4.26. The table holds 2843 active rows.
- The Receiver's statements send 50k lines an hour; 31k an hour fits the rate, so each statement keeps up to 208 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 11k lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.
- Warning: The Receiver's counters read 12k pass lines an hour against 50k rows on the meter; rates are scaled by 4.26, which assumes the counters miss lines evenly across statements.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| jaeger | the account's bucket | 1 | 19k | 11k | 13 | 707 |
| kafka | the account's bucket | 1 | 31k | 20k | 13 | 1345 |
| `*` (any other service) | the account's bucket | 1 | | 15k | 13 | 1026 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
