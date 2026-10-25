# Rows run: 2026-10-25T01:39:12.000Z

Rows written: 47k of 31k an hour last hour (31k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 31k an hour, with 22k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 49k pass lines an hour against 47k rows the meter puts on it, so each statement's rate is scaled by 1.00. The table holds 4924 active rows.
- The Receiver's statements send 53k lines an hour; 31k an hour fits the rate, so each statement keeps up to 695 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 5925 lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| opentelemetry-collector | the account's bucket | 1 | 53k | 31k | 46 | 2053 |
| `*` (any other service) | the account's bucket | 1 | | 31k | 46 | 2053 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
