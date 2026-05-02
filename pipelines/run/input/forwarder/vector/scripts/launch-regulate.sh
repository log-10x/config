#!/bin/bash
# Launch script for Vector + Log10x Receiver (Linux/macOS)
#
# Starts both Log10x receiver and Vector in the correct order, with Log10x
# coming up first so its Unix sockets exist before Vector tries to connect.

set -e

TENX_BIN="${TENX_BIN:-tenx}"
VECTOR_BIN="${VECTOR_BIN:-vector}"
TENX_MODULES="${TENX_MODULES:-/etc/tenx/modules}"
VECTOR_CONFIG="${VECTOR_CONFIG:-${TENX_MODULES}/pipelines/run/modules/input/forwarder/vector/regulate/tenxNix.yaml}"
LOG_DIR="${LOG_DIR:-/var/log/tenx-vector}"
TENX_INPUT_SOCK="${TENX_INPUT_SOCK:-/tmp/tenx-vector-in.sock}"

mkdir -p "$LOG_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Vector + Log10x Receiver${NC}"
echo -e "${GREEN}========================================${NC}"

if ! command -v "$TENX_BIN" &> /dev/null; then
    echo -e "${RED}Error: tenx command not found. Please install Log10x first.${NC}"
    exit 1
fi

if ! command -v "$VECTOR_BIN" &> /dev/null; then
    echo -e "${RED}Error: vector command not found. Please install Vector first.${NC}"
    exit 1
fi

cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    [ -n "$TENX_PID" ]   && kill $TENX_PID   2>/dev/null || true
    [ -n "$VECTOR_PID" ] && kill $VECTOR_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

echo -e "${GREEN}Starting Log10x receiver...${NC}"
$TENX_BIN @run/input/forwarder/vector/regulate @apps/receiver > "$LOG_DIR/tenx-receiver.log" 2>&1 &
TENX_PID=$!
echo "Log10x PID: $TENX_PID"

echo "Waiting for Log10x to bind ${TENX_INPUT_SOCK}..."
for i in {1..30}; do
    [ -S "$TENX_INPUT_SOCK" ] && { echo -e "${GREEN}✓ Log10x is ready${NC}"; break; }
    [ $i -eq 30 ] && { echo -e "${RED}Error: Log10x failed to start within 30s${NC}"; cleanup; }
    sleep 1
done

echo -e "${GREEN}Starting Vector...${NC}"
$VECTOR_BIN --config "$VECTOR_CONFIG" > "$LOG_DIR/vector.log" 2>&1 &
VECTOR_PID=$!
echo "Vector PID: $VECTOR_PID"

echo ""
echo -e "${GREEN}Services are running!${NC}"
echo "Log10x:  PID $TENX_PID  ($LOG_DIR/tenx-receiver.log)"
echo "Vector:  PID $VECTOR_PID ($LOG_DIR/vector.log)"
echo ""
echo "Event Flow:"
echo "  Vector --[socket/unix]--> Log10x --[fluent/unix]--> Vector --> Destinations"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"

wait
