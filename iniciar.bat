@echo off
rem Doble clic para instalar (la primera vez) y abrir la CRM en Windows.
cd /d "%~dp0"
title VendeBot CRM

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo No tienes Node.js. Se abrira la pagina de descarga: instala la version LTS y vuelve a abrir este archivo.
  start https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias, espera un momento...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

node scripts\setup-local.js
if errorlevel 1 ( pause & exit /b 1 )

start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
call npm start
pause
