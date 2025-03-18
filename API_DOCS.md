# 信任演化博弈系统 API 文档

## 技术规格

- **通信协议**：基于 Socket.IO 的实时通信
- **数据格式**：JSON
- **服务器端口**：3000（默认）

## 客户端到服务器的事件

### 1. 连接服务器

```javascript
// 连接到Socket.IO服务器
socket = io('http://localhost:3000');
```

### 2. 加入游戏

**事件名称**：`joinGame`

**参数**：无

**描述**：玩家请求加入游戏，服务器会分配初始分数并将玩家添加到匹配队列中。

**示例**：
```javascript
socket.emit('joinGame');
```

### 3. 做出选择

**事件名称**：`makeChoice`

**参数**：
- `choice`（字符串）：玩家的选择，可以是 'cooperate'（合作）或 'betray'（背叛）

**描述**：玩家在游戏回合中做出"合作"或"背叛"的选择。

**示例**：
```javascript
socket.emit('makeChoice', 'cooperate');
// 或
socket.emit('makeChoice', 'betray');
```

## 服务器到客户端的事件

### 1. 游戏加入确认

**事件名称**：`gameJoined`

**参数**：
- `playerData`（对象）：包含玩家ID、初始分数、历史记录等信息
- `globalRewards`（对象）：包含当前游戏的奖励配置

**描述**：服务器确认玩家已加入游戏，并返回初始游戏数据。

**示例响应**：
```javascript
{
  playerData: {
    id: 'socket-id-123',
    score: 100,
    history: [],
    currentRound: 0
  },
  globalRewards: {
    cooperate: 3,
    betray: 5,
    bothCooperate: 2,
    bothBetray: 1
  }
}
```

### 2. 匹配成功

**事件名称**：`matchFound`

**参数**：
- `opponent`（字符串）：对手的ID

**描述**：服务器通知玩家已匹配到对手，可以开始游戏。

**示例响应**：
```javascript
{
  opponent: 'socket-id-456'
}
```

### 3. 回合完成

**事件名称**：`roundComplete`

**参数**：
- `score`（数字）：此回合获得的分数
- `totalScore`（数字）：玩家当前的总分数
- `opponentChoice`（字符串）：对手在此回合的选择

**描述**：服务器通知玩家当前回合已完成，并提供结果数据。

**示例响应**：
```javascript
{
  score: 2,
  totalScore: 102,
  opponentChoice: 'cooperate'
}
```

### 4. 游戏结束

**事件名称**：`gameEnd`

**参数**：
- `finalScore`（数字）：玩家的最终分数
- `history`（数组）：玩家所有回合的选择历史

**描述**：当玩家的分数低于0或完成100轮后，游戏结束。

**示例响应**：
```javascript
{
  finalScore: 135,
  history: ['cooperate', 'betray', 'cooperate', ...]
}
```

## 奖励机制说明

游戏的奖励机制基于以下规则：

1. 双方合作：两位玩家各获得 `bothCooperate` 点分数
2. 双方背叛：两位玩家各获得 `bothBetray` 点分数
3. 一方合作一方背叛：
   - 合作方：失去 `cooperate` 点分数
   - 背叛方：获得 `betray` 点分数

当前默认配置：
- `cooperate`: 3
- `betray`: 5
- `bothCooperate`: 2
- `bothBetray`: 1 