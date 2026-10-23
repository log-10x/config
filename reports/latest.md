# Rows run: 2026-10-23T16:26:29.000Z

Rows written: 67k of 25k an hour last hour (25k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 25k an hour, with 77k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 27k pass lines an hour against 67k rows the meter puts on it, so each statement's rate is scaled by 2.51. The table holds 5394 active rows.
- The Receiver's statements send 101k lines an hour; 25k an hour fits the rate, so each statement keeps up to 1670 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 7950 lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.
- Warning: The Receiver's counters read 27k pass lines an hour against 67k rows on the meter; rates are scaled by 2.51, which assumes the counters miss lines evenly across statements.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| fluentd-10x | the account's bucket | 1 | 2562 | 2562 | 111 | 170 |
| grafana | the account's bucket | 1 | 21k | 1670 | 111 | 111 |
| inventory | the account's bucket | 1 | 10k | 1670 | 111 | 111 |
| opentelemetry-collector | the account's bucket | 1 | 53k | 6681 | 111 | 445 |
| payment | the account's bucket | 1 | 151 | 151 | 111 | 10 |
| postgresql | the account's bucket | 1 | 5876 | 5876 | 111 | 391 |
| prometheus-server | the account's bucket | 1 | 3918 | 3918 | 111 | 261 |
| recommendation | the account's bucket | 1 | 4370 | 1972 | 111 | 131 |
| `*` (any other service) | the account's bucket | 1 | | 2267 | 111 | 151 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
