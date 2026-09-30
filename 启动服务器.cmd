@echo off
chcp 65001 >nul
cd /d "%~dp0"
title DEFUSE 游戏服务器
echo 正在启动 DEFUSE 游戏服务器...
echo 启动后在浏览器打开 http://localhost:8080 ，同一 Wi-Fi 的朋友用下面显示的局域网地址加入。
echo 关闭这个窗口即可停止服务器。
echo.
where node >nul 2>nul
if %errorlevel%==0 (
  node server\server.js
  goto end
)
set "CURSOR1=%LOCALAPPDATA%\Programs\cursor\Cursor.exe"
set "CURSOR2=D:\Users\think\AppData\Local\Programs\cursor\Cursor.exe"
set ELECTRON_RUN_AS_NODE=1
if exist "%CURSOR1%" (
  "%CURSOR1%" server\server.js
  goto end
)
if exist "%CURSOR2%" (
  "%CURSOR2%" server\server.js
  goto end
)
echo 没有找到 Node.js，请先安装：https://nodejs.org （选 LTS 版本），装好后再双击本文件。
:end
pause
