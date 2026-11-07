@echo off
title Dividen Astawa
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js belum terpasang. Install versi LTS dari https://nodejs.org lalu double-click file ini lagi.
  start "" https://nodejs.org
  pause
  exit /b
)
echo Membuka http://localhost:3000 ... Biarkan jendela ini terbuka selama memakai aplikasi.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 2; Start-Process 'http://localhost:3000'"
node server.js
pause
