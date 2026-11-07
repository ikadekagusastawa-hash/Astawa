@echo off
title Dividen Astawa (bisa dibuka dari HP)
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js belum terpasang. Install versi LTS dari https://nodejs.org lalu double-click file ini lagi.
  start "" https://nodejs.org
  pause
  exit /b
)
echo Buka salah satu alamat ini di browser HP (harus di Wi-Fi yang sama, jangan Wi-Fi publik):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo    http://%%b:3000
echo Jika Windows Firewall bertanya, pilih Allow / Izinkan.
set HOST=0.0.0.0
node server.js
pause
