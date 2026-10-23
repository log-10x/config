# Rows run: 2026-10-23T16:19:30.000Z

Rows written: 50k of 25k an hour last hour (25k rows an hour set in the policy; part_log on default.otel_logs); at these limits the table takes about 49k an hour, with 576 an hour of lines to the account's bucket.

- Outside the Receiver: 49k rows an hour (the meter less the Receiver's 876 pass lines). The table holds 2150 active rows.
- The Receiver's statements send 876 lines an hour; 0 an hour fits the rate, so each statement keeps up to 0 an hour and the noisiest give way first.
- The always-pass sample (5 lines a statement a window on every node, 50 more for an error statement over its limit) keeps about 300 lines an hour whatever the limits; the rate holds down to that floor.
- The meter read above the rate last hour; the limits below hold the next hour at the rate, and each node's totals bind inside every window.
- Warning: The always-pass sample alone keeps about 300 lines an hour, more than the 0 an hour that fits, so the table takes about 49k an hour above the rate. Raise the rate, lower rateReceiverBaselineCount, or add the noisiest services to the Receiver's scope.
- Warning: Rows from writers outside the Receiver already reach 49k an hour, at or above the rate, so the Receiver's services keep nothing beyond the always-pass sample.

| Service | Destination | Nodes | Sent an hour | Kept an hour | Limit per statement | Total |
|---|---|---|---|---|---|---|
| grafana | the account's bucket | 1 | 876 | 300 | 1 | 20 |
| `*` (any other service) | the account's bucket | 1 | | 300 | 1 | 20 |

Limits and totals are lines per 4-minute window per node. Error lines pass 50 over a limit per statement per node per window. The meter is `system.part_log` NewPart rows on default.otel_logs, read by the event's own time.
