# OpenTelemetry Collector + Log10x Launch Scripts

Helper script to launch Log10x and OpenTelemetry Collector together for local setup and testing outside Kubernetes.

## Overview

`launch-regulate.sh` automates the startup sequence:

1. Starts Log10x in regulate mode (`tenx @run/input/forwarder/otel-collector/regulate @apps/reducer`)
2. Waits for Log10x to be ready
3. Starts OpenTelemetry Collector with the matching config (`regulate/tenxNix.yaml`)
4. Prints status + log file locations
5. Gracefully shuts down both services on Ctrl+C

For production use, deploy via the `log10x-otel/opentelemetry-collector` Helm chart instead — it handles the same wiring at the pod level with the tenx sidecar pattern.

## Usage

```bash
chmod +x launch-regulate.sh
./launch-regulate.sh
```

To enable compact encoding (reducer with optimize flag), set the `reducerOptimize=true` env var before launching:

```bash
reducerOptimize=true ./launch-regulate.sh
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TENX_BIN` | `tenx` | Path to tenx executable |
| `OTELCOL_BIN` | `otelcol` | Path to otelcol executable |
| `TENX_MODULES` | `/etc/tenx/modules` | Path to tenx modules tree |
| `LOG_DIR` | `/var/log/tenx-otel` | Directory for log files |

Example:

```bash
TENX_BIN=/opt/log10x/bin/tenx \
OTELCOL_BIN=/usr/local/bin/otelcol-contrib \
LOG_DIR=/var/log/my-logs \
./launch-regulate.sh
```

## Log Files

```bash
tail -f /var/log/tenx-otel/tenx-reducer.log
tail -f /var/log/tenx-otel/otelcol.log
```

## Stopping

Press `Ctrl+C` in the terminal, or kill the processes manually:

```bash
pkill -f "tenx.*otel-collector"
pkill -f otelcol
```

## Prerequisites

1. **Log10x** — install from https://doc.log10x.com/install/
2. **OpenTelemetry Collector Contrib v0.143.0+** — required for syslog exporter Unix socket support

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/open-telemetry/opentelemetry-collector-releases/releases/latest/download/otelcol_linux_amd64 \
  -o /usr/local/bin/otelcol
chmod +x /usr/local/bin/otelcol
```

## Troubleshooting

Check if ports 4317 / 4318 are already in use:

```bash
netstat -tuln | grep -E "4317|4318"
lsof -i :4318
```

Verify both services are running:

```bash
ps aux | grep -E "tenx|otelcol"
```

Check the logs for errors:

```bash
cat /var/log/tenx-otel/tenx-reducer.log
cat /var/log/tenx-otel/otelcol.log
```

## See Also

- [OpenTelemetry Collector Configuration Files](../conf/README.md)
- [Log10x OTel Collector Integration Guide](../../../../../../modules/pipelines/run/modules/input/forwarder/otel-collector/index.md)
- [Log10x Documentation](https://doc.log10x.com/)
