@echo off
chcp 65001 >nul
cd /d "%~dp0"
title DEFUSE 公网隧道
echo 正在启动 DEFUSE 游戏服务器 + 公网隧道……
echo 服务器在另一个窗口里运行；这个窗口会显示公网地址。
echo 免费隧道每 52 分钟换一次地址，已经打开的游戏页面会自动跳到新地址；
echo 最新地址也会显示在游戏主菜单的「手机扫码」里。关掉两个窗口就停止。
echo.
set "NODE="
where node >/dev/null 2>/dev/null && set "NODE=node"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\cursor\Cursor.exe" set "NODE=%LOCALAPPDATA%\Programs\cursor\Cursor.exe"
if not defined NODE if exist "D:\Users\think\AppData\Local\Programs\cursor\Cursor.exe" set "NODE=D:\Users\think\AppData\Local\Programs\cursor\Cursor.exe"
if not defined NODE (
  echo 没有找到 Node.js，请先安装：https://nodejs.org （选 LTS 版本），装好后再双击本文件。
  pause
  exit /b
)
if not "%NODE%"=="node" set ELECTRON_RUN_AS_NODE=1
start "DEFUSE 游戏服务器" cmd /k ""%NODE%" server\server.js"
timeout /t 2 /nobreak >nul
"%NODE%" tools\tunnel.mjs
pause
