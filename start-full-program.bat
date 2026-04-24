@echo off
setlocal EnableExtensions EnableDelayedExpansion

title SCADA Robot UI - Full Startup
cd /d "%~dp0"

echo ==========================================
echo   SCADA Robot UI - Full Startup
echo ==========================================
echo.

call :resolve_npm
if not defined NPM_CMD (
	echo [ERROR] Cannot find a working npm.cmd.
	echo Please install Node.js LTS, then run this file again.
	echo.
	pause
	exit /b 1
)

echo [OK] Using npm: %NPM_CMD%
echo.

echo [1/4] Checking dependencies...
if exist "node_modules" (
	echo [OK] node_modules exists.
) else (
	echo [INFO] node_modules not found. Running npm install...
	call "%NPM_CMD%" install
	if errorlevel 1 (
		echo [ERROR] npm install failed.
		pause
		exit /b 1
	)
)
echo.

echo [2/4] Preparing .env...
if exist ".env" (
	echo [OK] .env already exists.
) else (
	if exist ".env.example" (
		copy /Y ".env.example" ".env" >nul
		echo [OK] Created .env from .env.example
	) else (
		echo [ERROR] .env is missing and .env.example was not found.
		pause
		exit /b 1
	)
)
echo.

echo [3/6] Starting frontend (Vite) first...
start "" /B "%NPM_CMD%" run dev -w frontend
start "" /B powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\open-ui-browser.ps1" -Url "http://localhost:5173/" -Port 5173 -PidFile ".runtime\browser.pid"
echo [OK] Frontend start command completed.
echo.

echo [4/6] Starting database...
call "%NPM_CMD%" run db:up
if errorlevel 1 (
	echo [WARN] Local PostgreSQL startup failed. Trying Docker fallback...
	call "%NPM_CMD%" run db:up:docker
	if errorlevel 1 (
		echo [ERROR] Could not start PostgreSQL - local service and Docker fallback both failed.
		pause
		exit /b 1
	)
)
echo [OK] Database start command completed.
echo.

echo [5/6] Waiting for DB...
call "%NPM_CMD%" exec -- wait-on tcp:127.0.0.1:5432
if errorlevel 1 (
	echo [ERROR] Database port 5432 is not ready.
	pause
	exit /b 1
)

echo.
echo [6/6] Starting Prisma Studio and backend...
start "" /B "%NPM_CMD%" run prisma:studio -- --browser none

call "%NPM_CMD%" run start -w backend
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
	echo [ERROR] Program stopped with exit code %EXIT_CODE%.
) else (
	echo Program stopped normally.
)
echo Press any key to close this window.
pause >nul
exit /b %EXIT_CODE%

:resolve_npm
set "NPM_CMD="
for /f "delims=" %%I in ('where.exe npm.cmd 2^>nul') do (
	call :test_npm "%%I"
	if defined NPM_CMD goto :eof
)
if not defined NPM_CMD call :test_npm "%ProgramFiles%\nodejs\npm.cmd"
if not defined NPM_CMD call :test_npm "%ProgramFiles(x86)%\nodejs\npm.cmd"
goto :eof

:test_npm
set "CANDIDATE=%~1"
if not exist "%CANDIDATE%" if /i not "%CANDIDATE%"=="npm.cmd" goto :eof
call "%CANDIDATE%" -v >nul 2>&1
if "%ERRORLEVEL%"=="0" set "NPM_CMD=%CANDIDATE%"
goto :eof
