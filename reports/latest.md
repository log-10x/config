# Rows run: 2026-10-25T01:40:12.000Z

Rows written: 12k of 31k an hour last hour (31k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 31k an hour, with 27k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 14k pass lines an hour against 12k rows the meter puts on it, so each statement's rate is scaled by 1.00. The table holds 5078 active rows.
- The Receiver's statements send 58k lines an hour; 31k an hour fits the rate, so each statement keeps up to 778 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 4980 lines an hour whatever the limits; the rate holds down to that floor.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| inventory | the account's bucket | 1 | 5280 | 778 | 51 | 51 |
| opentelemetry-collector | the account's bucket | 1 | 53k | 30k | 51 | 2001 |
| `*` (any other service) | the account's bucket | 1 | | 15k | 51 | 1026 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
