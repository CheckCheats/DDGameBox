@echo off
chcp 65001 >nul
title DD Game Box 本地代理服务器
echo ========================================
echo  DD Game Box 本地下载代理
echo  启动后浏览器会自动连接
echo  无需 GitHub Token 即可下载游戏
echo ========================================
echo.
echo  要求: DepotDownloader\ddv20.exe 存在
echo.
echo  按 Ctrl+C 可停止服务
echo.
echo ========================================
echo  正在启动...
echo.

python "%~dp0local-server.py"

echo.
echo 服务已停止。按任意键退出...
pause >nul
