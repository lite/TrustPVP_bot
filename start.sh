#!/bin/bash

# 确保脚本可执行
# chmod +x start.sh

# 停止并移除现有容器
echo "正在停止并移除现有容器..."
docker compose down

# 构建并启动容器
echo "正在构建并启动容器..."
docker compose up -d --build

# 显示容器状态
echo "容器状态:"
docker compose ps

echo "信任演化博弈系统已启动!"
echo "访问 http://localhost:3000 开始游戏" 