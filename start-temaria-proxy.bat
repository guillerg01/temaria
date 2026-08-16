@echo off
setlocal
cd /d "%~dp0"
title Temaria - proxy local y ngrok
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-temaria-proxy.ps1"
if errorlevel 1 (
  echo.
  echo El proxy termino con un error. Revisa el mensaje anterior.
  pause
)
