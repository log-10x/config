# Vector Forwarder Configuration

Default configuration files for Log10x integration with [Vector](https://vector.dev).

## Overview

The Vector integration provides two deployment modes:

- **report** — Read and report on events for metrics aggregation (read-only, parallel branch)
- **regulate** — Filter and regulate which events to ship based on policies (the `reducerOptimize` flag enables encoding/optimize mode within the same pipeline)

## Configuration Files

- `report/config.yaml` — Reporter configuration
- `regulate/config.yaml` — Reducer configuration (covers regulate and optimize modes)

## Architecture

Vector runs alongside the 10x sidecar in the same pod (or host) and they communicate over Unix domain sockets:

1. Vector's `socket` sink writes newline-delimited records to `/tmp/tenx-vector-in.sock`
2. Log10x reads, processes (report / regulate / optimize), and writes filtered events back via the Fluent Forward protocol to `/tmp/tenx-vector-out.sock` (regulate/optimize modes only)
3. Vector's `fluent` source consumes the filtered stream and ships to final sinks

Loop prevention is structural — the to-tenx and from-tenx legs are disconnected in Vector's component graph.
