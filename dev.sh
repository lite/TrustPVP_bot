#!/bin/bash

# 确保脚本可执行
# chmod +x dev.sh

# 停止并移除现有开发容器
echo "正在停止并移除现有开发容器..."
docker compose -f docker-compose.dev.yml down

# 构建并启动开发容器
echo "正在构建并启动开发容器..."
docker compose -f docker-compose.dev.yml up -d --build

# 显示容器状态
echo "容器状态:"
docker compose -f docker-compose.dev.yml ps

echo "信任演化博弈系统开发环境已启动!"
echo "访问 http://localhost:3000 开始游戏"
echo "应用日志可通过以下命令查看:"
echo "docker compose -f docker-compose.dev.yml logs -f app" 