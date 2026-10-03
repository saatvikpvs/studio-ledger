@echo off
setlocal
cd /d "%~dp0apps\api"

echo Installing backend dependencies...
pip install -r requirements.txt
if errorlevel 1 goto :error

echo.
set /p OWNER_EMAIL="Enter the login email you'll sign in with: "
set /p OWNER_PASSWORD="Enter a password (10+ characters): "
set /p OPENING="Enter the current bank balance, e.g. 50000 (or 0): "

python -m app.setup_studio --reset --opening "%OPENING%"
if errorlevel 1 goto :error

cd /d "%~dp0apps\web"
echo.
echo Installing frontend dependencies...
call npm install
if errorlevel 1 goto :error

echo Building the app...
call npm run build
if errorlevel 1 goto :error

echo.
echo ================================================
echo  Setup complete. Double-click windows-start.bat
echo  any time you want to open the ledger.
echo ================================================
pause
goto :eof

:error
echo.
echo Something went wrong -- see the error above.
pause
