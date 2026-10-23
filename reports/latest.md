# Rows run: 2026-10-23T16:27:31.000Z

Rows written: 78k of 25k an hour last hour (25k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 25k an hour, with 109k an hour of lines to the account's bucket.

- Outside the Receiver: 0 rows an hour (outside_rows_per_hour). The Receiver's counters read 88k pass lines an hour against 78k rows the meter puts on it, so each statement's rate is scaled by 1.00. The table holds 6205 active rows.
- The Receiver's statements send 133k lines an hour; 25k an hour fits the rate, so each statement keeps up to 746 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 7785 lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| ad | the account's bucket | 1 | 2700 | 1673 | 49 | 111 |
| cart | the account's bucket | 1 | 11k | 1493 | 49 | 99 |
| fluentd-10x | the account's bucket | 1 | 5880 | 3986 | 49 | 265 |
| frontend | the account's bucket | 1 | 1080 | 825 | 49 | 55 |
| grafana | the account's bucket | 1 | 37k | 1365 | 49 | 91 |
| inventory | the account's bucket | 1 | 6960 | 746 | 49 | 49 |
| kafka | the account's bucket | 1 | 17k | 9702 | 49 | 646 |
| opensearch | the account's bucket | 1 | 120 | 120 | 49 | 8 |
| opentelemetry-collector | the account's bucket | 1 | 49k | 3064 | 49 | 204 |
| quote | the account's bucket | 1 | 60 | 60 | 49 | 4 |
| recommendation | the account's bucket | 1 | 2580 | 746 | 49 | 49 |
| valkey-cart | the account's bucket | 1 | 720 | 720 | 49 | 48 |
| `*` (any other service) | the account's bucket | 1 | | 1095 | 49 | 73 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
