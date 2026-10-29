@echo off
rem Runs the mirror's server, and starts it again if it ever stops.
rem start-mirror.bat opens this window. Close it to stop the mirror.
title Magic Mirror server
cd /d "%~dp0.."
:run
call npm start
echo.
echo The mirror's server stopped. Starting it again in 5 seconds; close this window to stop it.
timeout /t 5 /nobreak >nul
goto run
