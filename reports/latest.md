# Rows run: 2026-10-25T01:43:10.000Z

Rows written: 29k of 31k an hour last hour (31k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 31k an hour, with 101k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 31k pass lines an hour against 29k rows the meter puts on it, so each statement's rate is scaled by 1.00. The table holds 7309 active rows.
- The Receiver's statements send 132k lines an hour; 31k an hour fits the rate, so each statement keeps up to 982 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 6285 lines an hour whatever the limits; the rate holds down to that floor.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| ad | the account's bucket | 1 | 4200 | 2744 | 65 | 182 |
| cart | the account's bucket | 1 | 13k | 3104 | 65 | 206 |
| fluentd-10x | the account's bucket | 1 | 720 | 720 | 65 | 48 |
| frontend | the account's bucket | 1 | 3660 | 3262 | 65 | 217 |
| grafana | the account's bucket | 1 | 37k | 1942 | 65 | 129 |
| inventory | the account's bucket | 1 | 7140 | 982 | 65 | 65 |
| kafka | the account's bucket | 1 | 15k | 13k | 65 | 851 |
| opensearch | the account's bucket | 1 | 60 | 60 | 65 | 4 |
| opentelemetry-collector | the account's bucket | 1 | 49k | 3928 | 65 | 261 |
| recommendation | the account's bucket | 1 | 2100 | 982 | 65 | 65 |
| valkey-cart | the account's bucket | 1 | 300 | 300 | 65 | 20 |
| `*` (any other service) | the account's bucket | 1 | | 1942 | 65 | 129 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
