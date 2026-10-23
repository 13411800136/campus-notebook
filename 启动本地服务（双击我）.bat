@echo off
chcp 936 >nul
title 活动小本本 - 本地服务（关掉这个窗口就停止）
cd /d "%~dp0"
set "PORT=8899"
set "PY="

rem 目录末尾的反斜杠必须去掉，否则 --directory "...\" 里的 \" 会把引号转义掉
set "DIR=%CD%"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"

rem 8899 上如果已经是本项目在跑，直接开浏览器，不再起第二个
powershell -NoProfile -Command "try { $r = Invoke-WebRequest 'http://localhost:8899/' -UseBasicParsing -TimeoutSec 2; if ($r.Content -match 'id=.list.') { exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 (
  start "" http://localhost:8899/
  exit /b 0
)

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

if not exist "%DIR%\index.html" (
  echo  [x] 这个文件夹里没有 index.html，是不是把 bat 挪走啦？
  echo      当前目录：%DIR%
  pause
  exit /b 1
)

rem 8899 被别的程序占着就换 8900
powershell -NoProfile -Command "exit (Get-NetTCPConnection -State Listen -LocalPort %PORT% -ErrorAction SilentlyContinue | Measure-Object).Count"
if errorlevel 1 set "PORT=8900"

echo.
echo  正在把这个文件夹变成网页服务：
echo    %DIR%
echo  浏览器地址：http://localhost:%PORT%/
echo.
echo  这个黑窗口别关，关了服务就停；用完直接关掉它。
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:%PORT%/'"
"%PY%" -m http.server %PORT% --directory "%DIR%"
pause
