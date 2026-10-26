@echo off
rem Native Windows convenience wrapper around the supported tools-dev lifecycle.
setlocal
cd /d "%~dp0"
set "MELILLO_RUNTIME=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies"
if not exist "%MELILLO_RUNTIME%\node\bin\node.exe" (
  echo The Codex bundled Node 24 runtime was not found. Install Node 24 and pnpm 10.33.2, then use pnpm tools-dev start web.
  exit /b 1
)
set "PATH=%MELILLO_RUNTIME%\node\bin;%MELILLO_RUNTIME%\bin\fallback;%PATH%"
rem This workspace's large dev bundle can exceed Node's default heap after hot reloads.
rem An explicit inherited heap setting still wins because Node uses the last value.
set "NODE_OPTIONS=--max-old-space-size=6144 %NODE_OPTIONS%"
set "MELILLO_ACTION=start"
set "MELILLO_SCOPE=web"
set "MELILLO_PORTS=--daemon-port 17456 --web-port 17573"
if "%~1"=="" goto launch
if /i "%~1"=="start" goto launch
if /i "%~1"=="restart" set "MELILLO_ACTION=restart"
if /i "%~1"=="restart" goto launch
if /i "%~1"=="status" set "MELILLO_ACTION=status"
if /i "%~1"=="status" set "MELILLO_SCOPE="
if /i "%~1"=="status" set "MELILLO_PORTS="
if /i "%~1"=="status" goto launch
if /i "%~1"=="stop" set "MELILLO_ACTION=stop"
if /i "%~1"=="stop" set "MELILLO_SCOPE="
if /i "%~1"=="stop" set "MELILLO_PORTS="
if /i "%~1"=="stop" goto launch
echo Usage: MelilloDesign.cmd [start^|restart^|status^|stop]
exit /b 2
:launch
call "%MELILLO_RUNTIME%\bin\fallback\pnpm.cmd" dlx pnpm@10.33.2 tools-dev %MELILLO_ACTION% %MELILLO_SCOPE% --namespace project-workspace %MELILLO_PORTS%
exit /b %ERRORLEVEL%
