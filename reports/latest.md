# Rows run: 2026-10-23T16:32:32.000Z

Rows written: 3120 of 25k an hour last hour (25k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 25k an hour, with 64k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 4800 pass lines an hour against 3120 rows the meter puts on it, so each statement's rate is scaled by 1.00. The table holds 7572 active rows.
- The Receiver's statements send 89k lines an hour; 25k an hour fits the rate, so each statement keeps up to 951 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 3765 lines an hour whatever the limits; the rate holds down to that floor.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| ad | the account's bucket | 1 | 4260 | 2262 | 63 | 150 |
| cart | the account's bucket | 1 | 9360 | 1902 | 63 | 126 |
| fluentd-10x | the account's bucket | 1 | 720 | 720 | 63 | 48 |
| frontend | the account's bucket | 1 | 1140 | 951 | 63 | 63 |
| grafana | the account's bucket | 1 | 480 | 480 | 63 | 32 |
| inventory | the account's bucket | 1 | 5820 | 951 | 63 | 63 |
| kafka | the account's bucket | 1 | 16k | 12k | 63 | 824 |
| opensearch | the account's bucket | 1 | 60 | 60 | 63 | 4 |
| opentelemetry-collector | the account's bucket | 1 | 49k | 3803 | 63 | 253 |
| prometheus-server | the account's bucket | 1 | 60 | 60 | 63 | 4 |
| recommendation | the account's bucket | 1 | 1980 | 951 | 63 | 63 |
| `*` (any other service) | the account's bucket | 1 | | 951 | 63 | 63 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
