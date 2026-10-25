# Rows run: 2026-10-25T01:37:08.000Z

Rows written: 34k of 31k an hour last hour (31k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 31k an hour, with 33k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 18k pass lines an hour against 34k rows the meter puts on it, so each statement's rate is scaled by 1.85. The table holds 3335 active rows.
- The Receiver's statements send 64k lines an hour; 31k an hour fits the rate, so each statement keeps up to 1058 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 9525 lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.
- Warning: The Receiver's counters read 18k pass lines an hour against 34k rows on the meter; rates are scaled by 1.85, which assumes the counters miss lines evenly across statements.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| kafka | the account's bucket | 1 | 64k | 31k | 70 | 2053 |
| `*` (any other service) | the account's bucket | 1 | | 31k | 70 | 2053 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
