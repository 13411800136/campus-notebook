@echo off
chcp 936 >nul
title 活动小本本 - 本地服务（关掉这个窗口就停止）
cd /d "%~dp0"
set "PORT=8899"
set "PY="

where python >nul 2>nul
if not errorlevel 1 set "PY=python"
if not defined PY (
  where py >nul 2>nul
  if not errorlevel 1 set "PY=py"
)

if not defined PY (
  echo.
  echo  [x] 这台电脑上没找到 Python，起不了本地服务。
  echo      不影响使用：直接双击 index.html 就能打开全部功能，
  echo      只是收不到系统通知；到点弹窗、提醒条、提示音照常工作。
  echo.
  pause
  exit /b 1
)

echo.
echo  正在把这个文件夹变成网页服务：
echo    %CD%
echo  浏览器地址：http://localhost:%PORT%/
echo.
echo  这个黑窗口别关，关了服务就停；用完直接关掉它。
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:%PORT%/'"
"%PY%" -m http.server %PORT%
pause
