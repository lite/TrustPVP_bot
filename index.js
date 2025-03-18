require('dotenv').config();
const express = require('express');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const Redis = require('redis');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 设置静态文件目录
app.use(express.static(path.join(__dirname, 'public')));

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Redis 客户端配置
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// 游戏配置
const GAME_CONFIG = {
  INITIAL_SCORE: 100,
  MAX_ROUNDS: 100,
  HISTORY_LIMIT: 100,
  MIN_SCORE: 0
};

// 游戏状态
let gameState = {
  players: new Map(),
  waitingPlayers: new Set(),
  matches: new Map(), // 新增：存储当前对战关系
  globalRewards: {
    cooperate: 3,
    betray: 5,
    bothCooperate: 2,
    bothBetray: 1
  }
};

// Redis 连接
(async () => {
  try {
    await redisClient.connect();
    console.log('Redis连接成功');
  } catch (err) {
    console.error('Redis连接失败:', err);
  }
})();

// Socket.IO 事件处理
io.on('connection', (socket) => {
  console.log('新玩家连接:', socket.id);

  // 玩家加入游戏
  socket.on('joinGame', async () => {
    try {
      const playerData = {
        id: socket.id,
        score: GAME_CONFIG.INITIAL_SCORE,
        history: [],
        currentRound: 0,
        currentChoice: null
      };

      // 存储玩家数据到内存
      gameState.players.set(socket.id, playerData);

      // 存储到Redis (确保所有值都是字符串类型)
      await redisClient.hSet(`player:${socket.id}`, 
        'id', playerData.id,
        'score', String(playerData.score),
        'history', JSON.stringify(playerData.history),
        'currentRound', String(playerData.currentRound),
        'currentChoice', playerData.currentChoice || ''
      );

      // 发送游戏加入确认
      socket.emit('gameJoined', {
        playerData,
        globalRewards: gameState.globalRewards
      });

      // 添加到等待队列
      gameState.waitingPlayers.add(socket.id);
      console.log(`玩家 ${socket.id} 加入等待队列，当前等待玩家数: ${gameState.waitingPlayers.size}`);
      
      // 尝试匹配玩家
      matchPlayers();
    } catch (err) {
      console.error('加入游戏错误:', err);
      socket.emit('error', { message: '加入游戏失败，请重试' });
    }
  });

  // 玩家做出选择
  socket.on('makeChoice', async (choice) => {
    try {
      // 验证选择
      if (choice !== 'cooperate' && choice !== 'betray') {
        socket.emit('error', { message: '无效选择' });
        return;
      }

      const player = gameState.players.get(socket.id);
      if (!player) {
        socket.emit('error', { message: '玩家未找到' });
        return;
      }

      // 查找当前对手
      const opponentId = findOpponent(socket.id);
      if (!opponentId) {
        socket.emit('error', { message: '未找到对手' });
        return;
      }

      // 更新选择
      player.currentChoice = choice;
      player.history.push(choice);
      if (player.history.length > GAME_CONFIG.HISTORY_LIMIT) {
        player.history.shift();
      }

      // 更新Redis
      await redisClient.hSet(`player:${socket.id}`, 
        'history', JSON.stringify(player.history),
        'currentChoice', choice
      );

      console.log(`玩家 ${socket.id} 选择了 ${choice}`);

      // 检查回合是否完成
      checkMatchCompletion(socket.id, opponentId);
    } catch (err) {
      console.error('处理选择错误:', err);
      socket.emit('error', { message: '处理选择失败' });
    }
  });

  // 断开连接处理
  socket.on('disconnect', () => {
    try {
      // 处理匹配关系
      const opponentId = findOpponent(socket.id);
      if (opponentId) {
        const opponent = gameState.players.get(opponentId);
        if (opponent) {
          // 通知对手断开连接
          io.to(opponentId).emit('opponentDisconnected', {
            message: '对手已断开连接，请等待新匹配'
          });
          
          // 将对手放回等待队列
          gameState.matches.delete(socket.id);
          gameState.matches.delete(opponentId);
          gameState.waitingPlayers.add(opponentId);
          
          // 尝试重新匹配
          matchPlayers();
        }
      }

      // 清理玩家数据
      gameState.players.delete(socket.id);
      gameState.waitingPlayers.delete(socket.id);
      gameState.matches.delete(socket.id);
      redisClient.del(`player:${socket.id}`).catch(console.error);

      console.log(`玩家断开连接: ${socket.id}`);
    } catch (err) {
      console.error('断开连接处理错误:', err);
    }
  });
});

// 查找玩家当前对手
function findOpponent(playerId) {
  return gameState.matches.get(playerId);
}

// 玩家匹配逻辑
function matchPlayers() {
  const waitingPlayers = Array.from(gameState.waitingPlayers);
  if (waitingPlayers.length >= 2) {
    const player1Id = waitingPlayers[0];
    const player2Id = waitingPlayers[1];
    
    // 确保两个玩家都存在
    const player1 = gameState.players.get(player1Id);
    const player2 = gameState.players.get(player2Id);
    
    if (!player1 || !player2) {
      // 清理无效玩家
      if (!player1) {
        gameState.waitingPlayers.delete(player1Id);
        console.log(`移除无效玩家: ${player1Id}`);
      }
      if (!player2) {
        gameState.waitingPlayers.delete(player2Id);
        console.log(`移除无效玩家: ${player2Id}`);
      }
      return;
    }
    
    // 从等待队列中移除
    gameState.waitingPlayers.delete(player1Id);
    gameState.waitingPlayers.delete(player2Id);
    
    // 建立匹配关系
    gameState.matches.set(player1Id, player2Id);
    gameState.matches.set(player2Id, player1Id);
    
    // 重置选择
    player1.currentChoice = null;
    player2.currentChoice = null;
    
    // 通知玩家匹配成功
    io.to(player1Id).emit('matchFound', { opponent: player2Id });
    io.to(player2Id).emit('matchFound', { opponent: player1Id });
    
    console.log(`匹配成功: ${player1Id} 和 ${player2Id}`);
  }
}

// 检查特定匹配的回合完成情况
function checkMatchCompletion(player1Id, player2Id) {
  const player1 = gameState.players.get(player1Id);
  const player2 = gameState.players.get(player2Id);
  
  if (!player1 || !player2) {
    console.log('回合检查: 部分玩家不存在');
    return;
  }
  
  // 检查两位玩家是否都已做出选择
  if (player1.currentChoice && player2.currentChoice) {
    console.log(`回合完成: ${player1Id} 选择了 ${player1.currentChoice}, ${player2Id} 选择了 ${player2.currentChoice}`);
    
    // 计算得分
    const scores = calculateScores(player1.currentChoice, player2.currentChoice);
    
    // 更新玩家分数
    player1.score += scores.player1;
    player2.score += scores.player2;
    
    // 更新轮次
    player1.currentRound++;
    player2.currentRound++;
    
    // 更新Redis
    updatePlayerRedisData(player1Id, player1);
    updatePlayerRedisData(player2Id, player2);
    
    // 发送结果
    io.to(player1Id).emit('roundComplete', {
      score: scores.player1,
      totalScore: player1.score,
      opponentChoice: player2.currentChoice
    });
    
    io.to(player2Id).emit('roundComplete', {
      score: scores.player2,
      totalScore: player2.score,
      opponentChoice: player1.currentChoice
    });
    
    // 重置选择
    player1.currentChoice = null;
    player2.currentChoice = null;
    
    // 检查游戏是否结束
    const player1Ended = checkGameEnd(player1Id);
    const player2Ended = checkGameEnd(player2Id);
    
    // 处理匹配关系
    gameState.matches.delete(player1Id);
    gameState.matches.delete(player2Id);
    
    // 如果游戏没有结束，重新将玩家加入匹配队列
    if (!player1Ended && gameState.players.has(player1Id)) {
      gameState.waitingPlayers.add(player1Id);
    }
    
    if (!player2Ended && gameState.players.has(player2Id)) {
      gameState.waitingPlayers.add(player2Id);
    }
    
    // 尝试匹配新一轮
    matchPlayers();
  }
}

// 更新玩家Redis数据
async function updatePlayerRedisData(playerId, player) {
  try {
    await redisClient.hSet(`player:${playerId}`, 
      'score', String(player.score),
      'history', JSON.stringify(player.history),
      'currentRound', String(player.currentRound),
      'currentChoice', player.currentChoice || ''
    );
  } catch (err) {
    console.error(`更新Redis数据错误 (${playerId}):`, err);
  }
}

// 计算得分
function calculateScores(choice1, choice2) {
  const { bothCooperate, bothBetray, cooperate, betray } = gameState.globalRewards;
  
  if (choice1 === 'cooperate' && choice2 === 'cooperate') {
    return { player1: bothCooperate, player2: bothCooperate };
  } else if (choice1 === 'betray' && choice2 === 'betray') {
    return { player1: bothBetray, player2: bothBetray };
  } else if (choice1 === 'cooperate' && choice2 === 'betray') {
    return { player1: -cooperate, player2: betray };
  } else {
    return { player1: betray, player2: -cooperate };
  }
}

// 检查游戏是否结束
function checkGameEnd(playerId) {
  const player = gameState.players.get(playerId);
  if (!player) return true;
  
  if (player.score <= GAME_CONFIG.MIN_SCORE || 
      player.currentRound >= GAME_CONFIG.MAX_ROUNDS) {
    
    // 通知玩家游戏结束
    io.to(playerId).emit('gameEnd', {
      finalScore: player.score,
      history: player.history
    });
    
    // 清理玩家数据
    gameState.players.delete(playerId);
    gameState.waitingPlayers.delete(playerId);
    gameState.matches.delete(playerId);
    redisClient.del(`player:${playerId}`).catch(console.error);
    
    console.log(`游戏结束: ${playerId}, 得分: ${player.score}, 回合数: ${player.currentRound}`);
    return true;
  }
  
  return false;
}

// 启动服务器
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`访问 http://localhost:${PORT} 开始游戏`);
});
