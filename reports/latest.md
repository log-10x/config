# Rows run: 2026-10-23T16:22:32.000Z

Rows written: 27k of 25k an hour last hour (25k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 25k an hour, with 7865 an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 4920 pass lines an hour against 27k rows the meter puts on it, so each statement's rate is scaled by 5.56. The table holds 3165 active rows.
- The Receiver's statements send 32k lines an hour; 25k an hour fits the rate, so each statement keeps up to 1025 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 5636 lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.
- Warning: The Receiver's counters read 4920 pass lines an hour against 27k rows on the meter; rates are scaled by 5.56, which assumes the counters miss lines evenly across statements.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| opensearch | the account's bucket | 1 | 18k | 11k | 68 | 718 |
| opentelemetry-collector | the account's bucket | 1 | 14k | 14k | 68 | 915 |
| `*` (any other service) | the account's bucket | 1 | | 12k | 68 | 816 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
