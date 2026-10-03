@echo off
rem DEFUSE server + public tunnel launcher (ASCII only, see the other launcher for why).
cd /d "%~dp0"
title DEFUSE tunnel
set "NODE="
where node >/dev/null 2>/dev/null && set "NODE=node"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\cursor\Cursor.exe" set "NODE=%LOCALAPPDATA%\Programs\cursor\Cursor.exe"
if not defined NODE if exist "D:\Users\think\AppData\Local\Programs\cursor\Cursor.exe" set "NODE=D:\Users\think\AppData\Local\Programs\cursor\Cursor.exe"
if not defined NODE goto nonode
if not "%NODE%"=="node" set ELECTRON_RUN_AS_NODE=1
echo Starting DEFUSE server (in a second window) and the public tunnel (in this window)...
echo The public address is printed below and changes about once an hour. Close both windows to stop.
echo.
start "DEFUSE server" cmd /k ""%NODE%" server\server.js"
timeout /t 2 /nobreak >nul
"%NODE%" tools\tunnel.mjs
goto end
:nonode
echo Node.js was not found. Install the LTS version from https://nodejs.org and run this file again.
:end
pause
