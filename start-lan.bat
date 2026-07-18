@echo off
title Tank Trouble - LAN Server
cd /d "%~dp0"
echo.
echo  ==========================================
echo   TANK TROUBLE - Home WiFi Server
echo  ==========================================
echo.
echo   On your phone / brother's phone, open:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo      http://%%b:3000
)
echo.
echo   Everyone must be on the SAME WiFi.
echo   Keep this window open while playing.
echo  ==========================================
echo.
node server.js
pause
