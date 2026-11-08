@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
title 创建专属影视仓
cd /d "%~dp0"
echo.
where python >nul 2>nul
if errorlevel 1 (
  echo 没找到 Python。请先安装 Python 3：https://www.python.org/downloads/
  echo 安装时记得勾选 "Add Python to PATH"，然后重新双击本文件。
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo 没找到 Git。请先安装 Git：https://git-scm.com/download/win
  pause
  exit /b 1
)
python "%~dp0scripts\deploy.py"
if errorlevel 1 (
  echo.
  echo 部署未完成，请根据上面的报错处理后重新双击本文件。
  pause
  exit /b 1
)
pause
