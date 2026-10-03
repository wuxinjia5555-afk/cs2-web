@echo off
rem Dev server for previews (used by .claude/launch.json). ASCII only.
cd /d "%~dp0.."
where node >nul 2>nul && goto usenode
set ELECTRON_RUN_AS_NODE=1
if exist "%LOCALAPPDATA%\Programs\cursor\Cursor.exe" "%LOCALAPPDATA%\Programs\cursor\Cursor.exe" server\server.js & goto :eof
"D:\Users\think\AppData\Local\Programs\cursor\Cursor.exe" server\server.js
goto :eof
:usenode
node server\server.js
