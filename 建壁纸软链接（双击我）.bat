@echo off
chcp 936 >nul
title 给 3D 背景建壁纸软链接
cd /d "%~dp0"
set "TARGET=D:\SteamLibrary\steamapps\workshop\content\431960\3799142774"

if not exist "%TARGET%" (
  echo.
  echo  [x] 没找到壁纸目录：
  echo      %TARGET%
  echo      请先把 Wallpaper Engine 那张「Rhine Lab」壁纸订阅/下载好。
  echo.
  pause
  exit /b 1
)

if exist "wallpaper" (
  echo  已经建过 wallpaper 软链接了，不用再建。
  pause
  exit /b 0
)

cmd /c mklink /J "wallpaper" "%TARGET%"
if errorlevel 1 (
  echo.
  echo  [x] 建链接失败。可以把项目文件夹换个位置再试，或者直接用桌面版（活动小本本.exe）。
  pause
  exit /b 1
)

echo.
echo  建好了：wallpaper 指向
echo    %TARGET%
echo  现在双击「启动本地服务（双击我）.bat」，浏览器打开就有 3D 背景。
echo.
pause
