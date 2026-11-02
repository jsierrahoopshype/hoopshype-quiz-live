@echo off
title HoopsHype NBA Quiz Live - update
cd /d "%~dp0"
echo Downloading the latest version from GitHub...
set "TMPZIP=%TEMP%\hoopshype-quiz-live-latest.zip"
set "TMPDIR=%TEMP%\hoopshype-quiz-live-latest"
if exist "%TMPDIR%" rmdir /s /q "%TMPDIR%"
powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing 'https://github.com/jsierrahoopshype/hoopshype-quiz-live/archive/refs/heads/main.zip' -OutFile '%TMPZIP%'; Expand-Archive -Force '%TMPZIP%' '%TMPDIR%'"
if not exist "%TMPDIR%\hoopshype-quiz-live-main\index.html" (
  echo Download failed. Check your internet connection and try again.
  pause
  exit /b
)
rem Copy the new files over this folder. Your saved scores (saved), recap cards (recap-cards),
rem settings (config.json) and the installed chat reader (node_modules) are left alone.
robocopy "%TMPDIR%\hoopshype-quiz-live-main" "%~dp0." /E /XD saved recap-cards node_modules /XF config.json UPDATE-HOOPSHYPE-QUIZ.bat /NFL /NDL /NJH /NJS /NP >nul
rmdir /s /q "%TMPDIR%"
del "%TMPZIP%" >nul 2>nul
echo.
echo Updated. Your scores, champions, teams, recap cards and config.json were kept.
pause
