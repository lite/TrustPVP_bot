# 信任演化博弈系统 WebSocket API 文档

本文档描述了信任演化博弈系统的 WebSocket API，包括客户端与服务器之间的通信协议和所有可用事件。

## 通信协议

系统使用 WebSocket 作为通信协议，而非 HTTP 轮询。全部通信通过 Socket.IO 库实现，并强制使用 WebSocket 传输层。

### 连接设置

**客户端连接配置：**

```javascript
const socket = io('http://localhost:3000', {
    transports: ['websocket'], // 强制使用WebSocket
    upgrade: false, // 禁止协议升级
    reconnectionAttempts: 5, // 重连次数
    timeout: 10000 // 连接超时时间
});
```

**服务器连接配置：**

```javascript
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket'],
  allowUpgrades: false
});
```

## 服务器端 API

### 基础事件

| 事件名 | 说明 | 参数 | 返回 |
|--------|------|------|------|
| `connection` | 客户端连接事件 | Socket 对象 | - |
| `disconnect` | 客户端断开连接 | `reason` 断开原因 | - |

### 用户事件

| 事件名 | 说明 | 参数 | 返回 |
|--------|------|------|------|
| `login` | 玩家注册/登录 | `{ playerName, playerId? }` | 触发 `loginSuccess` 或 `error` |
| `joinGame` | 玩家加入游戏 | - | 触发 `gameJoined` 或 `error` |
| `makeChoice` | 玩家做出选择 | `'cooperate'` 或 `'betray'` | 触发 `roundComplete` 或 `error` |
| `getLeaderboard` | 获取排行榜 | - | 触发 `leaderboardData` |
| `getPlayerStats` | 获取玩家统计 | - | 触发 `playerStats` |
| `ping` | 测量延迟 | - | 回调函数，返回延迟时间 |

### 数据结构

#### 玩家数据

```javascript
{
  id: String,          // 玩家唯一ID
  name: String,        // 玩家名称
  score: Number,       // 当前分数
  history: Array,      // 历史选择
  currentRound: Number, // 当前回合
  currentChoice: String, // 当前选择
  totalGames: Number   // 总游戏次数
}
```

#### 奖励机制

```javascript
{
  cooperate: Number,    // 合作方损失
  betray: Number,       // 背叛方获得
  bothCooperate: Number, // 双方合作各得
  bothBetray: Number    // 双方背叛各得
}
```

## 客户端 API

### 接收事件

| 事件名 | 说明 | 参数 |
|--------|------|------|
| `connect` | 连接成功 | - |
| `connect_error` | 连接错误 | `error` 对象 |
| `disconnect` | 断开连接 | `reason` 断开原因 |
| `loginSuccess` | 登录成功 | `{ playerData, isNewPlayer }` |
| `gameJoined` | 加入游戏成功 | `{ playerData, globalRewards }` |
| `matchFound` | 匹配成功 | `{ opponent, opponentName }` |
| `roundComplete` | 回合完成 | `{ score, totalScore, opponentChoice, opponentName }` |
| `gameEnd` | 游戏结束 | `{ finalScore, history, rounds, message }` |
| `opponentDisconnected` | 对手断开连接 | `{ message }` |
| `leaderboardData` | 排行榜数据 | `{ leaderboard }` |
| `playerStats` | 玩家统计数据 | `{ stats }` |
| `error` | 错误信息 | `{ message }` |

### 重连相关事件

| 事件名 | 说明 | 参数 |
|--------|------|------|
| `reconnect_attempt` | 尝试重连 | `attempt` 尝试次数 |
| `reconnect` | 重连成功 | - |
| `reconnect_error` | 重连错误 | `error` 对象 |
| `reconnect_failed` | 重连失败 | - |

## 错误处理

服务器会通过 `error` 事件向客户端发送错误信息，格式为：

```javascript
{
  message: String // 错误消息
}
```

常见错误包括：

- "请先登录"
- "玩家名称不能超过20个字符"
- "加入游戏失败，请重试"
- "您已在等待队列中"
- "您已在游戏中，请先完成当前回合"
- "玩家数据丢失，请重新登录"
- "未找到对手"
- "无效选择"

## 游戏流程

1. **连接服务器**
   - 使用 WebSocket 协议连接到服务器

2. **玩家登录**
   - 发送 `login` 事件，包含玩家名称和可选的玩家ID
   - 如果提供ID且存在，则恢复之前的玩家数据
   - 如果是新玩家，则分配新ID

3. **加入游戏**
   - 发送 `joinGame` 事件，进入等待队列
   - 服务器寻找匹配对手

4. **游戏进行**
   - 匹配成功后，收到 `matchFound` 事件
   - 双方做出选择（cooperate 或 betray）
   - 收到 `roundComplete` 事件，显示本轮结果
   - 回合结束后重新匹配对手

5. **游戏结束**
   - 当分数归零或达到最大回合数时，收到 `gameEnd` 事件
   - 玩家可以再次加入游戏

## WebSocket 连接状态

### 断开连接原因

WebSocket 断开连接时，会收到以下可能的原因：

- `io server disconnect` - 服务器主动断开连接
- `io client disconnect` - 客户端主动断开连接
- `ping timeout` - 心跳检测超时
- `transport close` - 传输层关闭
- `transport error` - 传输层错误

### 心跳检测

系统使用 Socket.IO 内置的心跳机制来保持连接活跃并检测断线：

- 每隔一定时间发送一次 ping 包检测连接状态
- 客户端可使用 `ping` 事件手动测量延迟

## 数据持久化

玩家数据存储在 Redis 中，包括：

- 玩家ID、名称和得分
- 游戏历史和统计数据
- 最后登录时间

即使玩家断开连接，数据也会保留，允许玩家使用ID重新连接恢复数据。

## 性能考虑

- 使用 WebSocket 而非 HTTP 轮询，大幅减少服务器负载和网络延迟
- 定期清理不活跃连接，防止资源泄漏
- 使用 Redis 进行数据持久化，提供高性能数据存储

## 调试

客户端可以通过以下方式监控 WebSocket 连接状态：

- 连接状态显示（已连接/已断开）
- 传输类型（websocket）
- 连接时间
- 实时延迟测量

## 安全性考虑

- 所有玩家数据在存入 Redis 前会进行类型验证和转换
- 玩家名称长度限制，防止恶意输入
- 自动清理不活跃连接，防止资源耗尽攻击 