@echo off
cd /d "%~dp0apps\api"
start "Studio Ledger -- close this window to stop" cmd /k python -m uvicorn app.main:app --port 8000
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:8000
