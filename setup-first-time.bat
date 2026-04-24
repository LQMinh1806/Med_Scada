@echo off
setlocal EnableExtensions EnableDelayedExpansion

title SCADA Robot UI - First Time Setup
cd /d "%~dp0"

echo ==========================================
echo   SCADA Robot UI - First Time Setup
echo ==========================================
echo.

call :resolve_npm
if not defined NPM_CMD (
  echo [ERROR] Cannot find a working npm.cmd.
  echo Please install Node.js LTS first, then run this setup again.
  echo.
  pause
  exit /b 1
)

echo [OK] Using npm: %NPM_CMD%
echo.

echo [1/6] Checking Node.js and npm versions...
call "%NPM_CMD%" -v >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm is not functional.
  pause
  exit /b 1
)
for /f "delims=" %%V in ('node -v 2^>nul') do set "NODE_VER=%%V"
for /f "delims=" %%V in ('"%NPM_CMD%" -v 2^>nul') do set "NPM_VER=%%V"
echo      Node: !NODE_VER!
echo      npm : !NPM_VER!
echo.

echo [2/6] Installing dependencies (npm install)...
call "%NPM_CMD%" install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)
echo [OK] Dependencies installed.
echo.

echo [3/6] Preparing .env...
if exist ".env" (
  echo [OK] .env already exists. Skipping copy.
) else (
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    echo [OK] Created .env from .env.example
  ) else (
    echo [WARN] .env.example not found. Please create .env manually.
  )
)
echo.

echo [4/6] Starting PostgreSQL...
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

echo [5/6] Generating Prisma client...
call "%NPM_CMD%" run prisma:generate
if errorlevel 1 (
  echo [ERROR] Prisma client generation failed.
  pause
  exit /b 1
)
echo [OK] Prisma client generated.
echo.

echo [6/6] Applying migrations (prisma migrate deploy)...
call "%NPM_CMD%" exec -- prisma migrate deploy
if errorlevel 1 (
  echo [WARN] Prisma migration deploy failed.
  echo        Check DATABASE_URL in .env and ensure PostgreSQL is running.
  echo.
  echo You can retry later with: npm exec -- prisma migrate deploy
  pause
  exit /b 1
)
echo [OK] Prisma migration deploy completed.
echo.

echo ==========================================
echo Setup completed successfully.
echo Next step: run start-full-program.bat
echo ==========================================
echo.
pause
exit /b 0

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
if not exist "%CANDIDATE%" goto :eof
call "%CANDIDATE%" -v >nul 2>&1
if "%ERRORLEVEL%"=="0" set "NPM_CMD=%CANDIDATE%"
goto :eof
