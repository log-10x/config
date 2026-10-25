# Rows run: 2026-10-25T01:42:11.000Z

Rows written: 53k of 31k an hour last hour (31k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 31k an hour, with 108k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 46k pass lines an hour against 53k rows the meter puts on it, so each statement's rate is scaled by 1.16. The table holds 6856 active rows.
- The Receiver's statements send 139k lines an hour; 31k an hour fits the rate, so each statement keeps up to 692 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 11k lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| ad | the account's bucket | 1 | 4721 | 1383 | 46 | 92 |
| cart | the account's bucket | 1 | 13k | 2352 | 46 | 156 |
| fluentd-10x | the account's bucket | 1 | 13k | 11k | 46 | 712 |
| frontend | the account's bucket | 1 | 1250 | 825 | 46 | 55 |
| grafana | the account's bucket | 1 | 24k | 1311 | 46 | 87 |
| inventory | the account's bucket | 1 | 8540 | 692 | 46 | 46 |
| kafka | the account's bucket | 1 | 14k | 8990 | 46 | 599 |
| opensearch | the account's bucket | 1 | 139 | 139 | 46 | 9 |
| opentelemetry-collector | the account's bucket | 1 | 56k | 2900 | 46 | 193 |
| recommendation | the account's bucket | 1 | 3055 | 692 | 46 | 46 |
| valkey-cart | the account's bucket | 1 | 833 | 833 | 46 | 55 |
| `*` (any other service) | the account's bucket | 1 | | 1311 | 46 | 87 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
