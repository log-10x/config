#!/bin/bash
# Launch script for OpenTelemetry Collector + Log10x Receiver (Linux)
#
# This script starts both Log10x receiver and OpenTelemetry Collector
# in the correct order for event filtering and receiving.

set -e

# Configuration
TENX_BIN="${TENX_BIN:-tenx}"
OTELCOL_BIN="${OTELCOL_BIN:-otelcol}"
TENX_MODULES="${TENX_MODULES:-/etc/tenx/modules}"
OTEL_CONFIG="${TENX_MODULES}/pipelines/run/modules/input/forwarder/otel-collector/receive/tenxNix.yaml"
LOG_DIR="${LOG_DIR:-/var/log/tenx-otel}"

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}OpenTelemetry Collector + Log10x Receiver${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if tenx is installed
if ! command -v "$TENX_BIN" &> /dev/null; then
    echo -e "${RED}Error: tenx command not found. Please install Log10x first.${NC}"
    exit 1
fi

# Check if otelcol is installed
if ! command -v "$OTELCOL_BIN" &> /dev/null; then
    echo -e "${RED}Error: otelcol command not found. Please install OpenTelemetry Collector first.${NC}"
    exit 1
fi

# Cleanup function
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    if [ -n "$TENX_PID" ]; then
        echo "Stopping Log10x (PID: $TENX_PID)..."
        kill $TENX_PID 2>/dev/null || true
    fi
    if [ -n "$OTELCOL_PID" ]; then
        echo "Stopping OpenTelemetry Collector (PID: $OTELCOL_PID)..."
        kill $OTELCOL_PID 2>/dev/null || true
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start Log10x receiver
echo -e "${GREEN}Starting Log10x receiver...${NC}"
$TENX_BIN @run/input/forwarder/otel-collector/receive @apps/receiver > "$LOG_DIR/tenx-receiver.log" 2>&1 &
TENX_PID=$!
echo "Log10x PID: $TENX_PID"
echo "Log file: $LOG_DIR/tenx-receiver.log"

# Wait for Log10x to be ready
echo "Waiting for Log10x to start (listening on port 4318)..."
for i in {1..30}; do
    if netstat -tuln 2>/dev/null | grep -q ":4318 "; then
        echo -e "${GREEN}✓ Log10x is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Error: Log10x failed to start within 30 seconds${NC}"
        echo "Check log file: $LOG_DIR/tenx-receiver.log"
        cleanup
    fi
    sleep 1
done

# Start OpenTelemetry Collector
echo ""
echo -e "${GREEN}Starting OpenTelemetry Collector...${NC}"
$OTELCOL_BIN --config="$OTEL_CONFIG" > "$LOG_DIR/otelcol.log" 2>&1 &
OTELCOL_PID=$!
echo "OpenTelemetry Collector PID: $OTELCOL_PID"
echo "Log file: $LOG_DIR/otelcol.log"

# Wait for OTel Collector to be ready
echo "Waiting for OpenTelemetry Collector to start..."
for i in {1..30}; do
    if netstat -tuln 2>/dev/null | grep -q ":4317 "; then
        echo -e "${GREEN}✓ OpenTelemetry Collector is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Error: OpenTelemetry Collector failed to start within 30 seconds${NC}"
        echo "Check log file: $LOG_DIR/otelcol.log"
        cleanup
    fi
    sleep 1
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Services are running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Log10x Receiver:          PID $TENX_PID"
echo "OpenTelemetry Collector:   PID $OTELCOL_PID"
echo ""
echo "Event Flow:"
echo "  OTel Collector → TCP (4318) → Log10x → TCP (4319) → OTel Collector → Destinations"
echo ""
echo "Logs:"
echo "  Log10x:    $LOG_DIR/tenx-receiver.log"
echo "  OTel Col:  $LOG_DIR/otelcol.log"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Wait for processes
wait

