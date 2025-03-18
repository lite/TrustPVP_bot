require('dotenv').config();
const express = require('express');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const Redis = require('redis');
const { v4: uuidv4 } = require('uuid');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  // 强制使用WebSocket，禁用轮询
  transports: ['websocket'],
  allowUpgrades: false
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
  socketToPlayerId: new Map(), // 新增：存储socket.id到玩家ID的映射
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
    // 添加错误处理
    redisClient.on('error', (err) => {
      console.error('Redis错误:', err);
    });

    redisClient.on('reconnecting', () => {
      console.log('Redis重新连接中...');
    });

    redisClient.on('ready', () => {
      console.log('Redis准备就绪');
    });

    await redisClient.connect();
    console.log('Redis连接成功');
  } catch (err) {
    console.error('Redis连接失败:', err);
    // 5秒后重试连接
    setTimeout(() => {
      console.log('尝试重新连接到Redis...');
      redisClient.connect().catch(console.error);
    }, 5000);
  }
})();

// Socket.IO 服务器错误处理
io.engine.on('connection_error', (err) => {
  console.error('WebSocket连接错误:', err);
});

// 定期清理无效连接
setInterval(() => {
  console.log('当前活跃连接数:', io.engine.clientsCount);
  // 遍历所有连接，检查它们的状态
  const sockets = io.sockets.sockets;
  for (const [id, socket] of sockets) {
    // 检查最后活动时间
    const lastActiveTime = socket.handshake.issued;
    const inactiveTime = Date.now() - lastActiveTime;
    if (inactiveTime > 5 * 60 * 1000) { // 5分钟无活动
      console.log(`强制断开不活跃的连接: ${id}, 不活跃时间: ${inactiveTime / 1000}秒`);
      socket.disconnect(true);
    }
  }
}, 60000); // 每分钟检查一次

// Socket.IO 事件处理
io.on('connection', (socket) => {
  console.log('新WebSocket连接建立:', socket.id, '传输类型:', socket.conn.transport.name);

  // 设置ping/pong心跳间隔
  if (socket.conn.transport.name === 'websocket') {
    console.log('为WebSocket连接设置心跳检测');
    socket.conn.on('packet', (packet) => {
      if (packet.type === 'pong') {
        console.log(`收到WebSocket客户端 ${socket.id} 的心跳响应`);
      }
    });
  }

  // 连接断开处理
  socket.conn.on('close', (reason) => {
    console.log(`WebSocket连接 ${socket.id} 断开, 原因: ${reason}`);
  });

  // 玩家注册/登录
  socket.on('login', async (data) => {
    try {
      let playerId = data.playerId;
      const playerName = data.playerName || '匿名玩家';

      // 验证玩家名称
      if (playerName.length > 20) {
        socket.emit('error', { message: '玩家名称不能超过20个字符' });
        return;
      }

      let playerData;
      let isNewPlayer = false;

      // 检查是否是现有玩家
      if (playerId && await redisClient.exists(`player:${playerId}`)) {
        // 加载现有玩家数据
        const redisData = await redisClient.hGetAll(`player:${playerId}`);

        // 重建玩家数据
        playerData = {
          id: playerId,
          name: playerName, // 更新名称
          score: parseInt(redisData.score || GAME_CONFIG.INITIAL_SCORE),
          history: JSON.parse(redisData.history || '[]'),
          currentRound: parseInt(redisData.currentRound || 0),
          currentChoice: redisData.currentChoice || null,
          totalGames: parseInt(redisData.totalGames || 0)
        };

        console.log(`现有玩家登录: ${playerName} (ID: ${playerId})`);
      } else {
        // 创建新玩家
        playerId = uuidv4(); // 生成唯一ID
        playerData = {
          id: playerId,
          name: playerName,
          score: GAME_CONFIG.INITIAL_SCORE,
          history: [],
          currentRound: 0,
          currentChoice: null,
          totalGames: 0
        };

        isNewPlayer = true;
        console.log(`新玩家注册: ${playerName} (ID: ${playerId})`);
      }

      // 建立socket.id到playerId的映射
      gameState.socketToPlayerId.set(socket.id, playerId);

      // 存储玩家数据到内存
      gameState.players.set(playerId, playerData);

      // 更新Redis中的数据
      await redisClient.hSet(`player:${playerId}`,
        'id', playerData.id,
        'name', playerData.name,
        'score', String(playerData.score),
        'history', JSON.stringify(playerData.history),
        'currentRound', String(playerData.currentRound),
        'currentChoice', playerData.currentChoice || '',
        'totalGames', String(playerData.totalGames),
        'lastSeen', new Date().toISOString()
      );

      // 发送登录确认
      socket.emit('loginSuccess', {
        playerData,
        isNewPlayer
      });

      console.log(`玩家 ${playerName} (ID: ${playerId}) 登录成功`);
    } catch (err) {
      console.error('登录错误:', err);
      socket.emit('error', { message: '登录失败，请重试' });
    }
  });

  // 玩家加入游戏
  socket.on('joinGame', async () => {
    try {
      // 获取玩家ID
      const playerId = gameState.socketToPlayerId.get(socket.id);
      if (!playerId) {
        socket.emit('error', { message: '请先登录' });
        return;
      }

      // 获取玩家数据
      let player = gameState.players.get(playerId);
      if (!player) {
        // 尝试从Redis恢复
        const exists = await redisClient.exists(`player:${playerId}`);
        if (!exists) {
          socket.emit('error', { message: '玩家数据丢失，请重新登录' });
          return;
        }

        const redisData = await redisClient.hGetAll(`player:${playerId}`);
        player = {
          id: playerId,
          name: redisData.name || '匿名玩家',
          score: parseInt(redisData.score || GAME_CONFIG.INITIAL_SCORE),
          history: JSON.parse(redisData.history || '[]'),
          currentRound: parseInt(redisData.currentRound || 0),
          currentChoice: redisData.currentChoice || null,
          totalGames: parseInt(redisData.totalGames || 0)
        };

        gameState.players.set(playerId, player);
      }

      // 检查玩家是否已在游戏中
      if (gameState.waitingPlayers.has(playerId)) {
        socket.emit('error', { message: '您已在等待队列中' });
        return;
      }

      // 检查玩家是否已被匹配
      if (gameState.matches.has(playerId)) {
        socket.emit('error', { message: '您已在游戏中，请先完成当前回合' });
        return;
      }

      // 更新游戏总数
      player.totalGames++;

      // 重置游戏状态
      // player.currentRound = 0;
      // player.score = GAME_CONFIG.INITIAL_SCORE;
      // player.history = [];
      // player.currentChoice = null;

      // 更新Redis
      await updatePlayerRedisData(playerId, player);

      // 发送游戏加入确认
      socket.emit('gameJoined', {
        playerData: player,
        globalRewards: gameState.globalRewards
      });

      // 添加到等待队列
      gameState.waitingPlayers.add(playerId);
      console.log(`玩家 ${player.name} (ID: ${playerId}) 加入等待队列，当前等待玩家数: ${gameState.waitingPlayers.size}`);

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

      // 获取玩家ID
      const playerId = gameState.socketToPlayerId.get(socket.id);
      if (!playerId) {
        socket.emit('error', { message: '请先登录' });
        return;
      }

      const player = gameState.players.get(playerId);
      if (!player) {
        socket.emit('error', { message: '玩家未找到' });
        return;
      }

      // 查找当前对手
      const opponentId = findOpponent(playerId);
      if (!opponentId) {
        socket.emit('error', { message: '未找到对手' });
        return;
      }

      // 更新选择
      player.currentChoice = choice;
      player.history.push({
        round: player.currentRound,
        choice: choice,
        score: player.score,
        timestamp: new Date().toISOString(),
        rewards: { ...gameState.globalRewards }
      });
      if (player.history.length > GAME_CONFIG.HISTORY_LIMIT) {
        player.history.shift();
      }

      // 更新Redis
      await updatePlayerRedisData(playerId, player);

      console.log(`玩家 ${player.name} (ID: ${playerId}) 选择了 ${choice}`);

      // 检查回合是否完成
      checkMatchCompletion(playerId, opponentId);
    } catch (err) {
      console.error('处理选择错误:', err);
      socket.emit('error', { message: '处理选择失败' });
    }
  });

  // 断开连接处理
  socket.on('disconnect', () => {
    try {
      const playerId = gameState.socketToPlayerId.get(socket.id);
      if (!playerId) return;

      console.log(`玩家 ID: ${playerId} 断开连接`);

      // 处理匹配关系
      const opponentId = findOpponent(playerId);
      if (opponentId) {
        const opponent = gameState.players.get(opponentId);
        if (opponent) {
          // 获取对手的socket连接
          const opponentSocketId = findSocketByPlayerId(opponentId);

          if (opponentSocketId) {
            // 通知对手断开连接
            io.to(opponentSocketId).emit('opponentDisconnected', {
              message: '对手已断开连接，请等待新匹配'
            });
          }

          // 将对手放回等待队列
          gameState.matches.delete(playerId);
          gameState.matches.delete(opponentId);
          gameState.waitingPlayers.add(opponentId);

          // 尝试重新匹配
          matchPlayers();
        }
      }

      // 清理连接相关数据
      gameState.socketToPlayerId.delete(socket.id);
      gameState.waitingPlayers.delete(playerId);
      gameState.matches.delete(playerId);

      // 记录最后在线时间，但保留玩家数据
      const player = gameState.players.get(playerId);
      if (player) {
        // 保存所有数据，不仅是lastSeen
        updatePlayerRedisData(playerId, {
          ...player,
          lastSeen: new Date().toISOString()
        }).catch(err => console.error('断开连接保存数据错误:', err));

        gameState.players.delete(playerId);
      }
    } catch (err) {
      console.error('断开连接处理错误:', err);
    }
  });

  // ping/pong 处理器，用于测量延迟
  socket.on('ping', (_, callback) => {
    if (callback && typeof callback === 'function') {
      callback();
    }
  });

  // 获取排行榜
  socket.on('getLeaderboard', async () => {
    try {
      const leaderboard = await getTopPlayers(10);
      socket.emit('leaderboardData', { leaderboard });
    } catch (err) {
      console.error('获取排行榜错误:', err);
      socket.emit('error', { message: '获取排行榜失败' });
    }
  });

  // 获取玩家历史数据
  socket.on('getPlayerStats', async () => {
    try {
      const playerId = gameState.socketToPlayerId.get(socket.id);
      if (!playerId) {
        socket.emit('error', { message: '请先登录' });
        return;
      }

      const stats = await getPlayerStats(playerId);
      socket.emit('playerStats', { stats });
    } catch (err) {
      console.error('获取玩家统计数据错误:', err);
      socket.emit('error', { message: '获取统计数据失败' });
    }
  });
});

// 通过玩家ID查找Socket ID
function findSocketByPlayerId(playerId) {
  for (const [socketId, id] of gameState.socketToPlayerId.entries()) {
    if (id === playerId) return socketId;
  }
  return null;
}

// 查找玩家当前对手
function findOpponent(playerId) {
  return gameState.matches.get(playerId);
}

// 获取排行榜玩家
async function getTopPlayers(limit = 10) {
  try {
    // 获取所有玩家ID
    const keys = await redisClient.keys('player:*');
    if (!keys.length) return [];

    const players = [];

    // 获取每个玩家的数据
    for (const key of keys) {
      const playerData = await redisClient.hGetAll(key);
      if (playerData.name && playerData.score) {
        // 从key中提取正确的玩家ID
        const playerId = key.replace('player:', '');
        players.push({
          id: playerData.id || playerId, // 优先使用存储的ID，否则使用key中的ID
          name: playerData.name,
          score: parseInt(playerData.score),
          currentRound: parseInt(playerData.currentRound || '0'),
          totalGames: parseInt(playerData.totalGames || '0')
        });
      }
    }

    // 按分数排序
    players.sort((a, b) => b.score - a.score);

    // 返回前N名
    return players.slice(0, limit);
  } catch (err) {
    console.error('获取排行榜错误:', err);
    return [];
  }
}

// 获取玩家统计数据
async function getPlayerStats(playerId) {
  try {
    if (!await redisClient.exists(`player:${playerId}`)) {
      return null;
    }

    const data = await redisClient.hGetAll(`player:${playerId}`);
    return {
      id: data.id,
      name: data.name,
      score: parseInt(data.score || '0'),
      totalGames: parseInt(data.totalGames || '0'),
      history: JSON.parse(data.history || '[]'),
      currentRound: parseInt(data.currentRound || '0'),
      lastSeen: data.lastSeen
    };
  } catch (err) {
    console.error('获取玩家统计数据错误:', err);
    return null;
  }
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

    // 获取socket连接
    const socket1Id = findSocketByPlayerId(player1Id);
    const socket2Id = findSocketByPlayerId(player2Id);

    if (socket1Id && socket2Id) {
      // 通知玩家匹配成功
      io.to(socket1Id).emit('matchFound', {
        opponent: player2Id,
        opponentName: player2.name,
        opponentHistory: player2.history.sort((a, b) => a.round - b.round).slice(-100).reverse()
      });

      io.to(socket2Id).emit('matchFound', {
        opponent: player1Id,
        opponentName: player1.name,
        opponentHistory: player1.history.sort((a, b) => a.round - b.round).slice(-100).reverse()
      });

      console.log(`匹配成功: ${player1.name} (${player1Id}) 和 ${player2.name} (${player2Id})`);
    } else {
      // 处理无效socket
      if (!socket1Id) {
        gameState.matches.delete(player1Id);
        gameState.matches.delete(player2Id);
        gameState.waitingPlayers.add(player2Id);
        console.log(`玩家 ${player1Id} 没有有效的socket连接`);
      }

      if (!socket2Id) {
        gameState.matches.delete(player1Id);
        gameState.matches.delete(player2Id);
        gameState.waitingPlayers.add(player1Id);
        console.log(`玩家 ${player2Id} 没有有效的socket连接`);
      }

      // 继续尝试匹配
      matchPlayers();
    }
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
    console.log(`回合完成: ${player1.name} (${player1Id}) 选择了 ${player1.currentChoice}, ${player2.name} (${player2Id}) 选择了 ${player2.currentChoice}`);

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

    // 获取socket连接
    const socket1Id = findSocketByPlayerId(player1Id);
    const socket2Id = findSocketByPlayerId(player2Id);

    if (socket1Id) {
      // 发送结果
      io.to(socket1Id).emit('roundComplete', {
        score: scores.player1,
        totalScore: player1.score,
        opponentChoice: player2.currentChoice,
        opponentName: player2.name
      });
    }

    if (socket2Id) {
      io.to(socket2Id).emit('roundComplete', {
        score: scores.player2,
        totalScore: player2.score,
        opponentChoice: player1.currentChoice,
        opponentName: player1.name
      });
    }

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
    if (!player || !playerId) {
      console.error('更新Redis数据错误: 无效的玩家数据');
      return;
    }

    await redisClient.hSet(`player:${playerId}`, {
      'id': player.id || playerId,
      'name': player.name || '匿名玩家',
      'score': String(player.score || GAME_CONFIG.INITIAL_SCORE),
      'history': JSON.stringify(player.history || []),
      'currentRound': String(player.currentRound || 0),
      'currentChoice': player.currentChoice || '',
      'totalGames': String(player.totalGames || 0),
      'lastUpdated': new Date().toISOString()
    });
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

    // 获取socket连接
    const socketId = findSocketByPlayerId(playerId);

    if (socketId) {
      // 通知玩家游戏结束
      io.to(socketId).emit('gameEnd', {
        finalScore: player.score,
        history: player.history,
        rounds: player.currentRound,
        message: player.score <= GAME_CONFIG.MIN_SCORE ?
          '您的分数已耗尽' : '您已完成最大回合数'
      });
    }

    // 更新玩家数据和Redis，但不删除玩家数据
    player.currentRound = 0;
    player.history = [];
    player.currentChoice = null;

    // 最终分数保持不变，确保保存到Redis
    updatePlayerRedisData(playerId, player);

    // 清理匹配状态
    gameState.waitingPlayers.delete(playerId);
    gameState.matches.delete(playerId);

    console.log(`游戏结束: ${player.name} (${playerId}), 得分: ${player.score}, 回合数: ${player.currentRound}`);
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
