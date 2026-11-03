@echo off
title HoopsHype NBA Quiz Live - keep this window open while streaming
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this computer.
  echo Download the LTS version from https://nodejs.org/ , install it, then double-click this file again.
  pause
  exit /b
)

rem First run only: download the TikTok chat reader
if not exist "node_modules\tiktok-live-connector" (
  echo First run: installing the chat reader. This takes a minute...
  call npm install --no-audit --no-fund
)

rem Open the quiz in its own portrait window (Chrome if installed, otherwise Edge)
set "URL=http://localhost:8787/"
if /i "%~1"=="practice" set "URL=http://localhost:8787/?practice=1"
set "FLAGS=--new-window --app=%URL% --window-size=608,1080 --autoplay-policy=no-user-gesture-required --user-data-dir=%TEMP%\hoopshype-quiz-window"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" %FLAGS%
) else (
  start "" msedge %FLAGS%
)

echo.
echo The quiz window is open. In TikTok LIVE Studio, add a Window Capture of "HoopsHype NBA Quiz Live".
echo Closing this black window stops the chat connection.
echo.
node bridge\quiz-bridge.mjs %~1
pause
