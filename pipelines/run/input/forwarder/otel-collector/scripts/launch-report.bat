@echo off
REM Launch script for OpenTelemetry Collector + Log10x Reporter (Windows)
REM
REM This script starts both Log10x reporter and OpenTelemetry Collector
REM in the correct order for metric aggregation.

setlocal enabledelayedexpansion

REM Configuration
if "%TENX_BIN%"=="" set TENX_BIN=tenx.exe
if "%OTELCOL_BIN%"=="" set OTELCOL_BIN=otelcol.exe
if "%TENX_MODULES%"=="" set TENX_MODULES=C:\Program Files\tenx\modules
set OTEL_CONFIG=%TENX_MODULES%\pipelines\run\modules\input\forwarder\otel-collector\report\tenxWin.yaml
if "%LOG_DIR%"=="" set LOG_DIR=%TEMP%\tenx-otel

REM Create log directory if it doesn't exist
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo ========================================
echo OpenTelemetry Collector + Log10x Reporter
echo ========================================
echo.

REM Check if tenx is installed
where %TENX_BIN% >nul 2>&1
if errorlevel 1 (
    echo Error: tenx command not found. Please install Log10x first.
    exit /b 1
)

REM Check if otelcol is installed
where %OTELCOL_BIN% >nul 2>&1
if errorlevel 1 (
    echo Error: otelcol command not found. Please install OpenTelemetry Collector first.
    echo Download from: https://github.com/open-telemetry/opentelemetry-collector-releases/releases
    exit /b 1
)

REM Start Log10x reporter
echo Starting Log10x reporter...
start "Log10x Reporter" /min %TENX_BIN% @run/input/forwarder/otel-collector/report @apps/edge/reporter > "%LOG_DIR%\tenx-reporter.log" 2>&1
echo Log file: %LOG_DIR%\tenx-reporter.log

REM Wait for Log10x to be ready
echo Waiting for Log10x to start (listening on port 4318)...
set /a counter=0
:wait_tenx
timeout /t 1 /nobreak >nul
netstat -an | findstr ":4318" >nul 2>&1
if errorlevel 1 (
    set /a counter+=1
    if !counter! geq 30 (
        echo Error: Log10x failed to start within 30 seconds
        echo Check log file: %LOG_DIR%\tenx-reporter.log
        exit /b 1
    )
    goto wait_tenx
)
echo * Log10x is ready
echo.

REM Start OpenTelemetry Collector
echo Starting OpenTelemetry Collector...
start "OpenTelemetry Collector" /min %OTELCOL_BIN% --config="%OTEL_CONFIG%" > "%LOG_DIR%\otelcol.log" 2>&1
echo Log file: %LOG_DIR%\otelcol.log

REM Wait for OTel Collector to be ready
echo Waiting for OpenTelemetry Collector to start...
set /a counter=0
:wait_otelcol
timeout /t 1 /nobreak >nul
netstat -an | findstr ":4317" >nul 2>&1
if errorlevel 1 (
    set /a counter+=1
    if !counter! geq 30 (
        echo Error: OpenTelemetry Collector failed to start within 30 seconds
        echo Check log file: %LOG_DIR%\otelcol.log
        exit /b 1
    )
    goto wait_otelcol
)
echo * OpenTelemetry Collector is ready
echo.

echo ========================================
echo Services are running!
echo ========================================
echo.
echo Services:
echo   Log10x Reporter
echo   OpenTelemetry Collector
echo.
echo Logs:
echo   Log10x:    %LOG_DIR%\tenx-reporter.log
echo   OTel Col:  %LOG_DIR%\otelcol.log
echo.
echo To stop services:
echo   1. Close the console windows, or
echo   2. Run: taskkill /F /FI "WINDOWTITLE eq Log10x Reporter*"
echo   3. Run: taskkill /F /FI "WINDOWTITLE eq OpenTelemetry Collector*"
echo.
pause

