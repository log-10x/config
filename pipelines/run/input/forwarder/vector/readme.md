# Vector Forwarder Configuration

Default configuration files for Log10x integration with [Vector](https://vector.dev).

## Overview

A single regulate wrapper covers all three modes — selected by receiver flags:

- **read-only** — `receiverReadOnly: true` — reads and reports on events for metrics aggregation; the receiver suppresses the return-loop output to Vector, so the integration is non-intervening.
- **regulate** (default) — Filter and drop events based on rules; surviving events are returned to Vector to ship.
- **optimize** — `receiverOptimize: true` — additionally encode emitted events for 50–80% volume reduction.

## Configuration Files

- `regulate/config.yaml` — single wrapper used for all three modes (mode is selected by `receiverReadOnly` / `receiverOptimize` flags)

## Architecture

Vector runs alongside the 10x sidecar in the same pod (or host) and they communicate over Unix domain sockets:

1. Vector's `socket` sink writes newline-delimited records to `/tmp/tenx-vector-in.sock`
2. Log10x reads, runs the receiver pipeline (report / regulate / optimize), and — unless `receiverReadOnly` is set — writes the resulting events back via the Fluent Forward protocol to `/tmp/tenx-vector-out.sock`
3. Vector's `fluent` source consumes the returned stream and ships to final sinks

Loop prevention is structural — the to-tenx and from-tenx legs are disconnected in Vector's component graph.
