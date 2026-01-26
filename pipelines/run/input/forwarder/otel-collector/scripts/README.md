# OpenTelemetry Collector + Log10x Launch Scripts

This directory contains helper scripts to launch both Log10x and OpenTelemetry Collector together for easy setup and testing.

## Overview

These scripts automate the startup process by:
1. Starting Log10x in the appropriate mode (report, regulate, or optimize)
2. Waiting for Log10x to be ready
3. Starting OpenTelemetry Collector with the correct configuration
4. Providing status output and log file locations
5. Gracefully shutting down both services on Ctrl+C

## Scripts

### Linux Scripts

- **`launch-report.sh`** - Start Log10x reporter + OTel Collector for metric aggregation
- **`launch-regulate.sh`** - Start Log10x regulator + OTel Collector for event filtering
- **`launch-optimize.sh`** - Start Log10x optimizer + OTel Collector for event transformation

### Windows Scripts

- **`launch-report.bat`** - Windows version of report launcher
- **`launch-regulate.bat`** - Windows version of regulate launcher (to be created)
- **`launch-optimize.bat`** - Windows version of optimize launcher (to be created)

## Usage

### Linux

Make scripts executable (if not already):
```bash
chmod +x *.sh
```

Launch in report mode:
```bash
./launch-report.sh
```

Launch in regulate mode:
```bash
./launch-regulate.sh
```

Launch in optimize mode:
```bash
./launch-optimize.sh
```

### Windows

Simply double-click the `.bat` file or run from command prompt:
```cmd
launch-report.bat
```

## Environment Variables

You can customize the behavior using environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `TENX_BIN` | `tenx` (Linux) / `tenx.exe` (Windows) | Path to tenx executable |
| `OTELCOL_BIN` | `otelcol` (Linux) / `otelcol.exe` (Windows) | Path to otelcol executable |
| `LOG_DIR` | `/var/log/tenx-otel` (Linux) / `%TEMP%\tenx-otel` (Windows) | Directory for log files |

### Example

```bash
# Use custom binary paths
TENX_BIN=/opt/log10x/bin/tenx \
OTELCOL_BIN=/usr/local/bin/otelcol-contrib \
LOG_DIR=/var/log/my-logs \
./launch-report.sh
```

## Log Files

After launching, you can monitor the logs:

**Linux:**
```bash
# Watch Log10x logs
tail -f /var/log/tenx-otel/tenx-reporter.log

# Watch OpenTelemetry Collector logs
tail -f /var/log/tenx-otel/otelcol.log
```

**Windows:**
```cmd
# View Log10x logs
type %TEMP%\tenx-otel\tenx-reporter.log

# View OpenTelemetry Collector logs
type %TEMP%\tenx-otel\otelcol.log
```

## Stopping Services

### Linux

Press `Ctrl+C` in the terminal where the script is running. This will gracefully shut down both services.

Alternatively, kill the processes manually:
```bash
pkill -f "tenx.*otel-collector"
pkill -f otelcol
```

### Windows

1. Close the console windows, or
2. Use Task Manager to end the processes, or
3. Run these commands:
```cmd
taskkill /F /FI "WINDOWTITLE eq Log10x*"
taskkill /F /FI "WINDOWTITLE eq OpenTelemetry Collector*"
```

## Troubleshooting

### Log10x fails to start

Check if port 4318 is already in use:
```bash
# Linux
netstat -tuln | grep 4318
lsof -i :4318

# Windows
netstat -an | findstr :4318
```

### OpenTelemetry Collector fails to start

Check if ports 4317/4318 are already in use:
```bash
# Linux
netstat -tuln | grep -E "4317|4318"

# Windows
netstat -an | findstr "4317 4318"
```

### Connection issues

Verify both services are running:
```bash
# Linux
ps aux | grep -E "tenx|otelcol"

# Windows
tasklist | findstr "tenx otelcol"
```

Check connectivity:
```bash
# Test Log10x TCP endpoint
curl -X POST http://localhost:4318/v1/logs -H "Content-Type: application/json" -d '{"test":"data"}'
```

### Log files show errors

Check the log files for detailed error messages:
```bash
# Linux
cat /var/log/tenx-otel/tenx-reporter.log
cat /var/log/tenx-otel/otelcol.log

# Windows
type %TEMP%\tenx-otel\tenx-reporter.log
type %TEMP%\tenx-otel\otelcol.log
```

## Prerequisites

### Required Software

1. **Log10x** - Install from https://doc.log10x.com/install/
2. **OpenTelemetry Collector** - Install from https://opentelemetry.io/docs/collector/installation/

### Linux Installation

```bash
# Install Log10x (example - adjust for your system)
curl -fsSL https://get.log10x.com/install.sh | bash

# Install OpenTelemetry Collector
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/open-telemetry/opentelemetry-collector-releases/releases/latest/download/otelcol_linux_amd64 \
  -o /usr/local/bin/otelcol
chmod +x /usr/local/bin/otelcol
```

### Windows Installation

1. Download Log10x from https://doc.log10x.com/install/win
2. Download OpenTelemetry Collector from https://github.com/open-telemetry/opentelemetry-collector-releases/releases

## Advanced Usage

### Running in Background (Linux)

Use `nohup` or `screen` to run in the background:

```bash
# Using nohup
nohup ./launch-report.sh > /dev/null 2>&1 &

# Using screen
screen -dmS tenx-otel ./launch-report.sh
# Later, attach to see status: screen -r tenx-otel
```

### Systemd Service (Linux)

Create a systemd service for automatic startup:

```ini
# /etc/systemd/system/tenx-otel-report.service
[Unit]
Description=Log10x + OpenTelemetry Collector Reporter
After=network.target

[Service]
Type=forking
ExecStart=/path/to/scripts/launch-report.sh
Restart=on-failure
User=tenx
Group=tenx

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable tenx-otel-report
sudo systemctl start tenx-otel-report
sudo systemctl status tenx-otel-report
```

## See Also

- [OpenTelemetry Collector Configuration Files](../conf/README.md)
- [Log10x OTel Collector Integration Guide](../../../../../../modules/pipelines/run/modules/input/forwarder/otel-collector/index.md)
- [Log10x Documentation](https://doc.log10x.com/)

