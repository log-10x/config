# Rows run: 2026-10-25T01:38:12.000Z

Rows written: 47k of 31k an hour last hour (31k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 31k an hour, with 17k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 22k pass lines an hour against 47k rows the meter puts on it, so each statement's rate is scaled by 2.12. The table holds 4167 active rows.
- The Receiver's statements send 48k lines an hour; 31k an hour fits the rate, so each statement keeps up to 344 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 12k lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.
- Warning: The Receiver's counters read 22k pass lines an hour against 47k rows on the meter; rates are scaled by 2.12, which assumes the counters miss lines evenly across statements.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| opensearch | the account's bucket | 1 | 13k | 8889 | 22 | 592 |
| opentelemetry-collector | the account's bucket | 1 | 35k | 22k | 22 | 1460 |
| `*` (any other service) | the account's bucket | 1 | | 15k | 22 | 1026 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
