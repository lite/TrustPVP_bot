// npm install socket.io-client typescript ts-node @types/node
// npx ts-node bot.ts

const { io } = require('socket.io-client');

  const MAX_ROUND = 2000;
class TrustPVPClient {
  private socket: any;
  private playerName: string;
  private playerId: string | null = null;
  private isInGame: boolean = false;
  // 添加对手历史记录跟踪
  private opponentHistory: Map<string, Array<string>> = new Map();
  // 添加当前对手ID跟踪
  private currentOpponentId: string = '';
  private currentOpponentName: string = '';
  // 添加回合计数器
  private roundCounter: Map<string, number> = new Map();
  private maxRounds: number = MAX_ROUND;
  
  // 新增：连续行为跟踪
  private consecutiveCooperate: Map<string, number> = new Map();
  private consecutiveBetray: Map<string, number> = new Map();
  // 新增：对手类型标记
  private opponentType: Map<string, string> = new Map(); // 'kind', 'hostile', 'neutral'
  // 新增：收益跟踪
  private playerScores: Map<string, number> = new Map();
  private opponentScores: Map<string, number> = new Map();
  // 新增：宽容概率基础值
  private baseForgivenessProbability: number = 0.2;
  
  // 新增：错误概率 - 模拟人类犯错
  private errorProbability: number = 0.05;
  
  // 新增：得分差值阈值，当自己的得分与对手得分差值达到该阈值时更倾向于背叛
  private scoreDifferenceThreshold: number = 10;
  
  constructor(serverUrl: string, playerName: string) {
    this.playerName = playerName;
    
    // 根据API文档配置Socket连接
    this.socket = io(serverUrl, {
      transports: ['websocket'], // 强制使用WebSocket
      upgrade: false, // 禁止协议升级
      reconnectionAttempts: 5, // 重连次数
      timeout: 10000 // 连接超时时间
    });

    this.setupEventListeners();
    this.joinGame();
  }

  private setupEventListeners(): void {
    // 基础连接事件
    this.socket.on('connect', () => {
      console.log('已连接到服务器');
      // this.login();
    });

    this.socket.on('connect_error', (error: Error) => {
      console.error('连接错误:', error);
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log('断开连接，原因:', reason);
      this.isInGame = false;
    });

    // 重连相关事件
    this.socket.on('reconnect_attempt', (attempt: number) => {
      console.log(`尝试重连 (${attempt})`);
    });

    this.socket.on('reconnect', () => {
      console.log('重连成功');
      if (this.playerId) {
        this.login();
      }
    });

    // 游戏相关事件
    this.socket.on('loginSuccess', (data: { playerData: any, isNewPlayer: boolean }) => {
      console.log('登录成功', data.isNewPlayer ? '(新玩家)' : '(老玩家)');
      this.playerId = data.playerData.id;
      // this.joinGame();
    });

    this.socket.on('gameJoined', (data: { playerData: any, globalRewards: any }) => {
      console.log('成功加入游戏');
      console.log('全局奖励机制:', data.globalRewards);
      this.isInGame = true;
      
      // 初始化回合计数器为1，为新游戏做准备
      if (this.currentOpponentId) {
        this.roundCounter.set(this.currentOpponentId, 1);
        console.log(`新游戏开始，重置回合计数器为1`);
      }
    });

    this.socket.on('matchFound', (data: { opponent: string, opponentName: string }) => {
      console.log(`匹配到对手: ${data.opponentName} (ID: ${data.opponent})`);
      
      // 保存当前对手ID和名称
      this.currentOpponentId = data.opponent;
      this.currentOpponentName = data.opponentName;
      
      // 根据对手历史行为决定策略
      const choice = this.decideStrategy(data.opponent);
      this.makeChoice(choice);
    });

    this.socket.on('roundComplete', (data: { 
      score: number, 
      totalScore: number, 
      opponentChoice: string, 
      opponentName: string,
      opponent?: string,
      opponentScore?: number // 添加对手得分参数，如果API返回的数据中包含
    }) => {
      console.log(`回合结束 - 得分: ${data.score}, 总分: ${data.totalScore}`);
      console.log(`对手 ${data.opponentName} 选择了: ${data.opponentChoice === 'cooperate' ? '合作' : '背叛'}`);
      
      // 使用API返回的对手ID或保存的当前对手ID
      const opponentId = data.opponent || this.currentOpponentId;
      
      if (opponentId) {
        this.recordOpponentChoice(opponentId, data.opponentChoice);
        console.log(`已记录对手选择: ID=${opponentId}, 选择=${data.opponentChoice}`);
        
        // 更新得分记录
        const opponentScore = data.opponentScore || 0; // 如果API没有提供对手得分，假设为0
        this.updateScores(opponentId, data.score, opponentScore);
        
        // 增加回合计数
        const currentRound = this.roundCounter.get(opponentId) || 1;
        this.roundCounter.set(opponentId, currentRound + 1);
        console.log(`当前完成第 ${currentRound} 回合，下一回合将是第 ${currentRound + 1} 回合`);
      } else {
        console.warn('无法记录对手选择：缺少对手ID');
      }
    });

    this.socket.on('gameEnd', (data: { 
      finalScore: number, 
      history: any[], 
      rounds: number, 
      message: string 
    }) => {
      console.log('游戏结束:', data.message);
      console.log(`最终得分: ${data.finalScore}, 总回合数: ${data.rounds}`);
      this.isInGame = false;
      
      // 游戏结束后使用新用户名重新登录并加入游戏
      console.log('游戏已结束，将使用新用户名重新加入游戏');
      
      // 短暂延迟后重新加入游戏
      setTimeout(() => {
        if (this.socket.connected) {
          this.joinGame();
        }
      }, 1000);
    });

    this.socket.on('opponentDisconnected', (data: { message: string }) => {
      console.log('对手断开连接:', data.message);
      this.isInGame = false;
      
      // 短暂延迟后重新加入游戏
      setTimeout(() => {
        if (this.socket.connected) {
          this.joinGame();
        }
      }, 1000);
    });

    this.socket.on('error', (data: { message: string }) => {
      console.error('错误:', data.message);
    });
  }

  private login(): void {
    // 生成随机时间戳后缀，确保总长度不超过15个字符
    const timestamp = Date.now() % 10000;  // 只取时间戳的后4位数字
    const randomSuffix = Math.floor(Math.random() * 100);  // 只使用2位随机数
    
    // 计算可用于原始用户名的最大长度
    const maxNameLength = 20 - (`_${timestamp}_${randomSuffix}`.length);
    
    // 如果原始用户名过长，则截断
    const baseName = this.playerName.substring(0, maxNameLength);
    const playerNameWithTimestamp = `${baseName}_${timestamp}_${randomSuffix}`;
    
    console.log(`尝试登录，使用临时用户名: ${playerNameWithTimestamp}...`);

    const loginData = this.playerId 
      ? { playerName: playerNameWithTimestamp, playerId: this.playerId }
      : { playerName: playerNameWithTimestamp };
    
    this.socket.emit('login', loginData);
  }

  public joinGame(): void {
    if (!this.isInGame) {
      this.login();

      // 延迟一小段时间后再加入游戏，确保登录请求已处理
      setTimeout(() => {
        this.socket.emit('joinGame');
      }, 500);
    }
  }

  // 记录对手选择的历史
  private recordOpponentChoice(opponentId: string, choice: string): void {
    if (!this.opponentHistory.has(opponentId)) {
      this.opponentHistory.set(opponentId, []);
      // 初始化连续行为计数器
      this.consecutiveCooperate.set(opponentId, 0);
      this.consecutiveBetray.set(opponentId, 0);
      // 初始化对手类型为中立
      this.opponentType.set(opponentId, 'neutral');
      // 初始化分数记录
      this.playerScores.set(opponentId, 0);
      this.opponentScores.set(opponentId, 0);
    }
    
    const history = this.opponentHistory.get(opponentId);
    if (history) {
      history.push(choice);
      console.log(`对手历史记录更新 - ID: ${opponentId}, 历史: [${history.join(', ')}]`);
      // 只保留最近的20次选择，防止历史记录过长
      if (history.length > 20) {
        history.shift();
      }
      
      // 更新连续行为计数
      if (choice === 'cooperate') {
        this.consecutiveCooperate.set(opponentId, (this.consecutiveCooperate.get(opponentId) || 0) + 1);
        this.consecutiveBetray.set(opponentId, 0);
        
        // 检查是否达到善良玩家标准（连续合作≥5次）
        if ((this.consecutiveCooperate.get(opponentId) || 0) >= 5) {
          this.opponentType.set(opponentId, 'kind');
          console.log(`对手 ${opponentId} 被标记为善良玩家（连续合作${this.consecutiveCooperate.get(opponentId)}次）`);
        }
      } else if (choice === 'betray') {
        this.consecutiveBetray.set(opponentId, (this.consecutiveBetray.get(opponentId) || 0) + 1);
        this.consecutiveCooperate.set(opponentId, 0);
        
        // 检查是否达到恶意玩家标准（连续背叛≥3次）
        if ((this.consecutiveBetray.get(opponentId) || 0) >= 3) {
          this.opponentType.set(opponentId, 'hostile');
          console.log(`对手 ${opponentId} 被标记为恶意玩家（连续背叛${this.consecutiveBetray.get(opponentId)}次）`);
        }
      }
    }
  }

  // 分析对手行为并决定策略
  private decideStrategy(opponentId: string): 'cooperate' | 'betray' {
    const currentRound = this.roundCounter.get(opponentId) || 1;
    const history = this.opponentHistory.get(opponentId);
    const opponentType = this.opponentType.get(opponentId) || 'neutral';
    
    console.log(`当前回合: ${currentRound}, 对手类型: ${opponentType}`);
    
    // 1. 第一回合默认合作
    if (!history || history.length === 0) {
      console.log(`第一回合，选择合作策略建立信任`);
      return 'cooperate';
    }
    
    // 2. 计算对手的背叛率和合作率
    const betrayRate = history.filter(choice => choice === 'betray').length / history.length;
    const cooperateRate = history.filter(choice => choice === 'cooperate').length / history.length;
    
    console.log(`对手行为分析 - 背叛率: ${(betrayRate * 100).toFixed(2)}%, 合作率: ${(cooperateRate * 100).toFixed(2)}%`);
    
    // 3. 计算得分差值
    const playerScore = this.playerScores.get(opponentId) || 0;
    const opponentScore = this.opponentScores.get(opponentId) || 0;
    const scoreDifference = playerScore - opponentScore;
    console.log(`得分差值: ${scoreDifference} (玩家: ${playerScore}, 对手: ${opponentScore})`);
    
    // 4. 根据对手的背叛率和得分差值决定策略
    let choice: 'cooperate' | 'betray';
    
    if (betrayRate > 0.5 || scoreDifference >= this.scoreDifferenceThreshold) {
      console.log(`选择背叛策略 - 原因: ${betrayRate > 0.5 ? '对手背叛率高' : '得分领先显著'}`);
      choice = 'betray';
    } else {
      console.log(`选择合作策略 - 对手背叛率低且得分差值未达阈值`);
      choice = 'cooperate';
    }
    
    // 5. 终局效应：最后两回合选择背叛
    if (currentRound >= this.maxRounds - 1) {
      console.log(`接近游戏结束(回合${currentRound}/${this.maxRounds})，选择背叛策略`);
      choice = 'betray';
    }
    
    // 6. 模拟犯错概率
    if (Math.random() < this.errorProbability) {
      const originalChoice = choice;
      choice = choice === 'cooperate' ? 'betray' : 'cooperate';
      console.log(`触发随机犯错机制(${this.errorProbability * 100}%)，原选择: ${originalChoice}，现选择: ${choice}`);
    }
    
    return choice;
  }

  // 更新得分记录
  private updateScores(opponentId: string, playerScore: number, opponentScore: number): void {
    const currentPlayerScore = this.playerScores.get(opponentId) || 0;
    const currentOpponentScore = this.opponentScores.get(opponentId) || 0;
    
    this.playerScores.set(opponentId, currentPlayerScore + playerScore);
    this.opponentScores.set(opponentId, currentOpponentScore + opponentScore);
    
    console.log(`得分更新 - 玩家: ${this.playerScores.get(opponentId)}, 对手: ${this.opponentScores.get(opponentId)}`);
  }

  private makeChoice(choice: 'cooperate' | 'betray'): void {
    console.log(`选择: ${choice === 'cooperate' ? '合作' : '背叛'}`);
    this.socket.emit('makeChoice', choice);
    
    // 注意：这里不需要增加回合计数，因为回合计数在roundComplete事件中已经处理
  }

  public getLeaderboard(): void {
    this.socket.emit('getLeaderboard');
    this.socket.once('leaderboardData', (data: { leaderboard: any }) => {
      console.log('排行榜数据:', data.leaderboard);
    });
  }

  public getPlayerStats(): void {
    this.socket.emit('getPlayerStats');
    this.socket.once('playerStats', (data: { stats: any }) => {
      console.log('玩家统计数据:', data.stats);
    });
  }

  public disconnect(): void {
    this.socket.disconnect();
  }
}

// 使用示例
// const serverUrl = 'http://localhost:3000'; // 替换为实际服务器地址
const serverUrl = 'http://118.123.202.87:13001'; // 替换为实际服务器地址
const playerName = 'old yao_2'; // 替换为你想要的玩家名称

const client = new TrustPVPClient(serverUrl, playerName);

// 处理程序退出
process.on('SIGINT', () => {
  console.log('正在断开连接并退出...');
  client.disconnect();
  process.exit(0);
});

console.log('智能策略客户端已启动，按 Ctrl+C 退出');