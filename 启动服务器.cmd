@echo off
rem DEFUSE game server launcher. This file is ASCII only on purpose: cmd.exe misreads
rem non-ASCII text in batch files on some systems. The server prints Chinese messages itself.
cd /d "%~dp0"
title DEFUSE server
set "NODE="
where node >/dev/null 2>/dev/null && set "NODE=node"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\cursor\Cursor.exe" set "NODE=%LOCALAPPDATA%\Programs\cursor\Cursor.exe"
if not defined NODE if exist "D:\Users\think\AppData\Local\Programs\cursor\Cursor.exe" set "NODE=D:\Users\think\AppData\Local\Programs\cursor\Cursor.exe"
if not defined NODE goto nonode
if not "%NODE%"=="node" set ELECTRON_RUN_AS_NODE=1
echo Starting DEFUSE server... Open http://localhost:8080 in your browser. Close this window to stop.
echo.
"%NODE%" server\server.js
goto end
:nonode
echo Node.js was not found. Install the LTS version from https://nodejs.org and run this file again.
:end
pause
