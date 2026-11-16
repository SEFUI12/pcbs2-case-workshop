@echo off
chcp 65001 >nul
title PCBS2 Case Workshop

rem A convenience launcher. You do NOT need this: opening web\index.html
rem directly works. It exists for browsers that refuse file:// (some Chrome
rem and Edge builds) by serving the same folder over 127.0.0.1.
rem Nothing leaves this machine and there is no network code in the app.

cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Python was not found on PATH.
  echo.
  echo   You can still use the workshop: open web\index.html in your browser.
  echo   This script only exists for browsers that block file:// pages.
  echo.
  pause
  exit /b 1
)

if not exist "web\index.html" (
  echo.
  echo   web\index.html is missing. Run this from the project folder.
  echo.
  pause
  exit /b 1
)

if not exist "web\data\vanilla_cases.js" (
  echo.
  echo   The generated data files are missing.
  echo   Run, in this order:
  echo     python tools\export_icons.py    --game "C:\Path\To\PCBS2"
  echo     python tools\extract_vanilla.py --game "C:\Path\To\PCBS2"
  echo     python tools\build_data_js.py
  echo   See README.md.
  echo.
  pause
  exit /b 1
)

if not exist "web\icons\index.js" (
  echo.
  echo   web\icons\index.js is missing. Run tools\export_icons.py, then
  echo   tools\build_data_js.py. See README.md.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting the Case Workshop on http://127.0.0.1:8770/
echo   Close this window to stop the server.
echo.
python tools\serve.py --port 8770 --open

if errorlevel 1 (
  echo.
  echo   The server could not start. Port 8770 may be in use.
  echo   Either open web\index.html directly, or pick another port:
  echo     python tools\serve.py --port 8799 --open
  echo.
  pause
)