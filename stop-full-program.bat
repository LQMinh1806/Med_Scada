@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "NO_PAUSE=0"
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"

title SCADA Robot UI - Stop
cd /d "%~dp0"

echo ==========================================
echo   SCADA Robot UI - Stop
echo ==========================================
echo.

echo [1/4] Closing browser opened by startup...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\close-ui-browser.ps1" -PidFile ".runtime\browser.pid" -Url "http://localhost:5173/"
echo.

echo [2/4] Stopping app ports...
call :kill_port 3000 "Backend (server.js)"
call :kill_port 5173 "Frontend (Vite dev server)"
call :kill_port 5555 "Prisma Studio"
echo.

echo [3/4] Stopping remaining project processes (targeted)...
powershell -NoProfile -Command "$patterns=@('server.js','vite','prisma studio'); $procs=Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'node.exe' -and $_.CommandLine -and ($patterns | ForEach-Object { $_ }) -match '.' }; $matches=$procs | Where-Object { $cmd=$_.CommandLine.ToLower(); $cmd -like '*server.js*' -or $cmd -like '*vite*' -or $cmd -like '*prisma*studio*' }; if($matches){ $matches | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output ('[OK] Stopped PID ' + $_.ProcessId) } } else { Write-Output '[INFO] No extra matching node processes found.' }"
echo.

echo [4/4] Stopping PostgreSQL container (if started by project)...
call :resolve_npm
if defined NPM_CMD (
  call "%NPM_CMD%" run db:down >nul 2>&1
  if "%ERRORLEVEL%"=="0" (
    echo [OK] PostgreSQL stop command completed.
  ) else (
    echo [INFO] PostgreSQL container may already be stopped.
  )
) else (
  echo [WARN] npm.cmd not found, skipped db:down.
)

echo.
if "%NO_PAUSE%"=="1" exit /b 0

echo Done. Press any key to close this window.
pause >nul
exit /b 0

:kill_port
set "PORT=%~1"
set "LABEL=%~2"
set "FOUND=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set "FOUND=1"
  taskkill /PID %%P /F >nul 2>&1
  if "!ERRORLEVEL!"=="0" (
    echo [OK] !LABEL!: stopped PID %%P on port !PORT!.
  ) else (
    echo [INFO] !LABEL!: PID %%P already stopped.
  )
)
if "%FOUND%"=="0" echo [INFO] !LABEL!: nothing listening on port !PORT!.
goto :eof

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
