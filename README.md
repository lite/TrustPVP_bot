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

## 安装和运行

### 前提条件

- Node.js v14.x 或更高版本
- Redis服务器

### 安装步骤

1. 克隆代码库：
```bash
git clone https://github.com/yourusername/trust-evolution-game.git
cd trust-evolution-game
```

2. 安装依赖：
```bash
npm install
```

3. 配置环境变量：
创建`.env`文件并添加以下内容：
```
PORT=3000
REDIS_URL=redis://localhost:6379
```

4. 启动Redis服务器：
```bash
redis-server
```

5. 启动游戏服务器：
```bash
node index.js
```

6. 访问游戏：
在浏览器中打开 `http://localhost:3000`

## 游戏规则

1. **准备阶段**：
   - 注册或使用已有ID登录
   - 点击"加入游戏"进入匹配队列

2. **对战阶段**：
   - 匹配到对手后，选择"合作"或"背叛"
   - 根据双方选择，系统分配相应分数：
     - 双方合作：各得2分
     - 双方背叛：各得1分
     - 一方合作一方背叛：合作方失去3分，背叛方得到5分

3. **结束条件**：
   - 玩家分数归零
   - 达到最大回合数（100轮）

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
  INITIAL_SCORE: 100,   // 初始分数
  MAX_ROUNDS: 100,      // 最大回合数
  HISTORY_LIMIT: 100,   // 历史记录限制
  MIN_SCORE: 0          // 最低分数
};
```

奖励机制可在`gameState.globalRewards`对象中修改：

```javascript
globalRewards: {
  cooperate: 3,        // 合作方失去的分数
  betray: 5,           // 背叛方获得的分数
  bothCooperate: 2,    // 双方合作各得的分数
  bothBetray: 1        // 双方背叛各得的分数
}
```

## 许可证

MIT

## 贡献指南

欢迎提交Issue和Pull Request！

## 作者

[您的名字] 