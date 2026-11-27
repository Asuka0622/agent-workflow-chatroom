@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [Multi-Agent 本地订阅工作流] 正在启动本地服务...
echo 浏览器访问：http://127.0.0.1:4310
start "" http://127.0.0.1:4310
npm start
