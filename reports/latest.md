# Hot-tier run: 2026-10-22T19:50:48.000Z

Hot tier: 1 MB of 29 MB (0.0287 GB set in the policy) on 1 hot node; at these limits it settles at about 36 MB within 3 hours, with 263 MB a day of counted lines moved to Flex.

- Outside the Receiver: 0 MB on hot. The Receiver's kept lines: 1 MB in 1 indices; its tier_down lines not yet moved: 0 MB in 1.
- A kept line stays on hot 3 hours (ILM policy tenx-keep (rollover max_age 1h + frozen min_age 2h)); a tier_down index 2 hours (default (no tier_down index has been moved yet)).
- Each counted byte takes 1.64 bytes of store kept, 1.64 as tier_down (measured on the indices on hot).
- The Receiver's statements send 263 MB a day; 0 MB a day fits the size, so each statement keeps up to 0 MB a day and the noisiest give way first.
- Warning: 1 documents on hot carry no utf8Size, so their statements count as 0 bytes. The Receiver writes it when installed for the hot-tier run.
- Warning: Lines outside the Receiver and the tier_down lines waiting to move already fill 29 MB, so the Receiver's services keep nothing beyond the always-pass sample of 5 lines a statement a window.

| Service | Destination | Nodes | Sent a day | Kept a day | Limit per statement | Total |
|---|---|---|---|---|---|---|
| accounting | Flex | 1 | 9 MB | 0 MB | 1 | 1 |
| ad | Flex | 1 | 11 MB | 0 MB | 1 | 1 |
| aws-eks-nodeagent | Flex | 1 | 0 MB | 0 MB | 1 | 1 |
| aws-node | Flex | 1 | 1 MB | 0 MB | 1 | 1 |
| aws-vpc-cni-init | Flex | 1 | 1 MB | 0 MB | 1 | 1 |
| cart | Flex | 1 | 22 MB | 0 MB | 1 | 1 |
| coredns | Flex | 1 | 6 MB | 0 MB | 1 | 1 |
| currency | Flex | 1 | 0 MB | 0 MB | 1 | 1 |
| email | Flex | 1 | 1 MB | 0 MB | 1 | 1 |
| flagd | Flex | 1 | 1 MB | 0 MB | 1 | 1 |
| flagd-ui | Flex | 1 | 0 MB | 0 MB | 1 | 1 |
| fraud-detection | Flex | 1 | 1 MB | 0 MB | 1 | 1 |
| frontend | Flex | 1 | 5 MB | 0 MB | 1 | 1 |
| frontend-proxy | Flex | 1 | 27 MB | 0 MB | 1 | 1 |
| grafana | Flex | 1 | 176 MB | 0 MB | 1 | 1 |
| init-config | Flex | 1 | 2 MB | 0 MB | 1 | 1 |
| `*` (any other service) | Flex | 1 | | 0 MB | 1 | 1 |

Limits and totals are bytes per 4-minute window per node, counted the way the Receiver counts them (utf8Size). Error lines pass 50 over a limit per statement per node per window.
