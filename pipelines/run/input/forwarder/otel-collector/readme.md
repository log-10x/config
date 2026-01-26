# OpenTelemetry Collector Forwarder Configuration

Default configuration files for Log10x integration with OpenTelemetry Collector.

## Overview

The OpenTelemetry Collector integration provides three deployment modes:

- **report** - Read and report on events for metrics aggregation
- **regulate** - Filter and regulate which events to ship based on policies  
- **optimize** - Transform and optimize events before shipping to outputs

## Configuration Files

- `report/config.yaml` - Reporter configuration
- `regulate/config.yaml` - Regulator configuration
- `optimize/config.yaml` - Optimizer configuration

## Architecture

Unlike other forwarders, OpenTelemetry Collector cannot launch a Log10x sidecar process. Instead:

1. Log10x runs as a standalone service
2. OTel Collector sends JSON events via TCP to Log10x
3. Log10x processes and returns optimized events via Unix socket (forward protocol)
4. OTel Collector forwards optimized events to final destinations

