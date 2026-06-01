#!/bin/bash
# AI 科研机制图绘制工具 - 启动脚本
cd "$(dirname "$0")"

# 构建前端
echo "Building frontend..."
cd frontend && npx vite build && cd ..

# 启动后端（自动 serve 前端产物）
echo "Starting backend at http://127.0.0.1:8000"
export TESSDATA_PREFIX="$HOME/tessdata"
python -m backend.main
