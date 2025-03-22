# 信任演化博弈系统

一个基于WebSocket的双人博弈系统，模拟经典的"囚徒困境"信任演化过程。

## 系统概述

信任演化博弈系统是一个实时在线双人博弈平台，玩家可以在每轮游戏中选择"合作"或"背叛"，系统会根据双方的选择分配相应的分数，并记录历史行为。游戏采用WebSocket通信协议，支持实时对战、玩家匹配、排行榜和数据统计。

### 主要特性

- **WebSocket实时通信**：基于Socket.IO实现的纯WebSocket通信
- **玩家账号系统**：支持自定义名称和通过ID重连
- **数据持久化**：使用Redis存储玩家数据
- **实时匹配**：自动匹配对手进行游戏
- **统计分析**：记录和展示玩家的游戏统计和历史
- **排行榜系统**：展示玩家排名
- **连接状态监控**：实时显示WebSocket连接状态和延迟

## 技术栈

- **前端**：原生HTML/CSS/JavaScript
- **后端**：Node.js, Express
- **通信**：Socket.IO (WebSocket)
- **数据存储**：Redis

## 使用 Docker 运行

本项目支持使用 Docker 和 Docker Compose 快速部署和运行。

### 前提条件

- 安装 [Docker](https://docs.docker.com/get-docker/)
- 安装 [Docker Compose](https://docs.docker.com/compose/install/)

### 生产环境启动

使用以下命令启动生产环境：

```bash
# 使用脚本启动
./start.sh

# 或者手动执行
docker-compose up -d
```

### 开发环境启动

开发环境启用了热重载功能，方便开发调试：

```bash
# 使用脚本启动
./dev.sh

# 或者手动执行
docker-compose -f docker-compose.dev.yml up -d
```

### 查看日志

```bash
# 生产环境日志
docker-compose logs -f app

# 开发环境日志
docker-compose -f docker-compose.dev.yml logs -f app
```

### 停止系统

```bash
# 停止生产环境
docker-compose down

# 停止开发环境
docker-compose -f docker-compose.dev.yml down
```

## 不使用 Docker 运行

如果您不想使用 Docker，也可以直接在本地运行：

### 前提条件

- Node.js v14.x 或更高版本
- Redis 服务器

### 安装步骤

1. 安装依赖：
```bash
npm install
```

2. 配置环境变量：
编辑 `.env` 文件并设置 Redis 连接和端口号。

3. 启动 Redis：
```bash
redis-server
```

4. 启动应用：
```bash
# 生产环境
npm start

# 开发环境
npm run dev
```

5. 访问应用：
打开浏览器访问 `http://localhost:3000`

## 游戏规则

1. **准备阶段**：
   - 注册或使用已有ID登录
   - 点击"加入游戏"进入匹配队列

2. **对战阶段**：
   - 匹配到对手后，选择"合作"或"背叛"
   - 根据双方选择，系统分配相应分数：
     - 双方合作：各得2分
     - 双方背叛：各得0分
     - 一方合作一方背叛：合作方失去1分，背叛方得到3分

3. **结束条件**：
   - 玩家分数归零
   - 达到最大回合数（365100轮）

4. **规则补充说明**：
   - 全局奖励得分，每三秒会变化一次。
   - 结算以匹配成功时收到的奖励得分作为结算。


## API文档

详细的API文档请参见 [API-docs.md](API-docs.md)。

## 开发指南

### 项目结构

```
├── index.js          // 主服务器文件
├── public/           // 静态资源文件夹
│   └── index.html    // 客户端页面
├── .env              // 环境变量配置
├── package.json      // 项目依赖
└── API-docs.md       // API文档
```

### 自定义配置

游戏配置可在`index.js`中的`GAME_CONFIG`对象中修改：

```javascript
const GAME_CONFIG = {
  INITIAL_SCORE: 1000,   // 初始分数
  MAX_ROUNDS: 100 * 365,      // 最大回合数
  HISTORY_LIMIT: 100 * 365,   // 历史记录限制
  MIN_SCORE: 0,          // 最低分数
  ACCIDENT_RATE: 0.05 // 每回合事故概率,如果出现事故则选择相反的动作
};
```

奖励机制可在`gameState.globalRewards`对象中修改：

```javascript
globalRewards: {
  cooperate: -1,        // 合作方失去的分数
  betray: 3,           // 背叛方获得的分数
  bothCooperate: 2,    // 双方合作各得的分数
  bothBetray: 0        // 双方背叛各得的分数
}
```

## 许可证

MIT

## 贡献指南

欢迎提交Issue和Pull Request！

## 作者

[Henry] 