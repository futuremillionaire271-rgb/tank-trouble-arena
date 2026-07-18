@echo off
title Tank Trouble Online
cd /d "%~dp0"
echo Starting Tank Trouble server...
start "TankTrouble-Server" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul
echo Starting public tunnel (watch below for your public URL)...
cloudflared.exe tunnel --url http://localhost:3000
