@echo off
rem The Magic Mirror for the party: double-click this file.
rem  1. Starts the mirror's server in its own window, and starts it again if it ever stops.
rem  2. Waits until the mirror answers.
rem  3. Opens Chrome full screen, with sound allowed.
rem To finish: Alt+F4 closes Chrome, then close the "Magic Mirror server" window.
setlocal
cd /d "%~dp0"
rem The server listens here (keep PORT at 5173 in .env).
set "MIRROR=http://127.0.0.1:5173/"

if not exist ".env" (
  echo There is no .env file yet: copy .env.example to .env and put your Groq key in it.
  pause
  exit /b 1
)

start "Magic Mirror server" cmd /k ""%~dp0scripts\server-loop.bat""

echo Waiting for the mirror to start. The first start takes a minute...
set /a tries=0
:wait
timeout /t 2 /nobreak >nul
set /a tries+=1
curl -s -o nul %MIRROR% && goto open
if %tries% lss 150 goto wait
echo The mirror did not start. The "Magic Mirror server" window says why.
pause
exit /b 1

:open
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER (
  echo Chrome or Edge was not found. Open %MIRROR% in a browser and press F11.
  pause
  exit /b 1
)
rem Its own browser profile, so these settings apply even when Chrome is already open. The
rem first time, Chrome asks to use the microphone: click Allow, and it remembers.
rem   --kiosk: full screen, no bars      --autoplay-policy: sound starts without a click
start "" "%BROWSER%" --kiosk --autoplay-policy=no-user-gesture-required --user-data-dir="%LocalAppData%\MagicMirrorBrowser" --no-first-run --no-default-browser-check %MIRROR%
endlocal
