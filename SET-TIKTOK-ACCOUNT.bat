@echo off
title HoopsHype NBA Quiz Live - set the TikTok account
cd /d "%~dp0"
rem Changes which TikTok account the quiz reads chat from (the "tiktokUsername" line in config.json).
rem Use it again the day the account changes, e.g. from hoopshypeofficial to hoopshype.
echo.
echo The quiz reads chat, gifts and likes from this TikTok account:
powershell -NoProfile -Command "(Get-Content -Raw 'config.json' | ConvertFrom-Json).tiktokUsername"
echo.
set "NEWNAME="
set /p "NEWNAME=Type the new username without the @ (or just press Enter to keep it): "
if "%NEWNAME%"=="" (
  echo Nothing changed.
  pause
  exit /b
)
powershell -NoProfile -Command "$p='config.json'; $c=Get-Content -Raw $p | ConvertFrom-Json; $c.tiktokUsername=('%NEWNAME%').Trim().TrimStart('@'); [IO.File]::WriteAllText((Resolve-Path $p), ($c | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))"
echo.
echo Done. The quiz now reads chat from:
powershell -NoProfile -Command "(Get-Content -Raw 'config.json' | ConvertFrom-Json).tiktokUsername"
echo Close the black quiz window if it is open, then double-click START-HOOPSHYPE-QUIZ.bat again.
pause
