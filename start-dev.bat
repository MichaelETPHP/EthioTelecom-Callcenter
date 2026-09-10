@echo off
REM Starts both projects for local development, fully natively (no Docker):
REM   - SMS Gateway API (Go server) on port 3000 - talks straight to the
REM     shared Postgres instance over the internet, no local DB needed
REM   - Call Center Console (Flask) on port 5000
REM Requires: Go (installed locally at %GOBIN_DIR% below - adjust if you
REM installed it elsewhere/via a system installer), Python + Flask.

setlocal
set "ROOT=%~dp0"
set "GOBIN_DIR=C:\Users\HP\go-sdk\go\bin"

echo Starting SMS Gateway API (go run: migrate then start) on port 3000...
start "SMS Gateway API" cmd /k "set "PATH=%GOBIN_DIR%;%%PATH%%" && set "GOTOOLCHAIN=local" && cd /d "%ROOT%sms-gateway-server" && set "CONFIG_PATH=configs/config.yml" && go run cmd\sms-gateway\main.go db:migrate up && go run cmd\sms-gateway\main.go"

echo Starting Call Center Console (Flask) on port 5000...
start "Call Center Console" cmd /k "cd /d "%ROOT%call" && python app.py"

echo.
echo Both services are starting in separate windows:
echo   SMS Gateway API  -^> http://localhost:3000  (docs: http://localhost:3000/api/docs)
echo   Call Console     -^> http://localhost:5000
echo.
echo Close each window to stop that service.

endlocal
