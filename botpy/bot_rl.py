import os
import time
import numpy as np
import torch
import logging
import argparse
from typing import List, Dict, Tuple, Optional

# Import our modules
from utils.client import TrustPVPClient
from utils.logger import BotLogger
from models.ppo_agent import PPOAgent

# Configure logging
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('bot_rl')

class TrustPVPRLBot:
    """Reinforcement Learning Bot for Trust PVP game."""
    
    def __init__(self, server_url, player_name, load_model=True, save_interval=10, debug_state=False):
        """Initialize the RL bot.
        
        Args:
            server_url: The URL of the game server
            player_name: The name of the player
            load_model: Whether to load a saved model if available
            save_interval: How often to save the model (in games)
        """
        self.server_url = server_url
        self.player_name = player_name
        self.save_interval = save_interval
        self.games_played = 0
        self.debug_state = debug_state

        # Initialize logger
        self.logger = BotLogger(log_dir='logs')
        
        # Initialize client
        self.client = TrustPVPClient(server_url, player_name)
        
        # Set up callbacks
        self.client.on_decision_needed = self.make_decision
        self.client.on_round_complete = self.process_round_result
        self.client.on_game_end = self.process_game_end
        
        # State representation size
        # [round_num, opponent_cooperate_rate, opponent_betray_rate, 
        #  consecutive_cooperate, consecutive_betray, is_last_round]
        # 保持状态维度一致
        self.state_dim = 6
        
        # Initialize RL agent
        # 初始化RL智能体
        self.agent = PPOAgent(
            input_dims=self.state_dim,
            n_actions=2,
            gamma=0.99,      # 可以调整为0.95-0.99
            alpha=0.0001,    # 降低学习率以提高稳定性
            gae_lambda=0.95,
            policy_clip=0.2,
            batch_size=128,  # 增加批量大小
            n_epochs=10
        )
        
        # Create models directory if it doesn't exist
        os.makedirs('models', exist_ok=True)
        
        # 不加载模型，准备重新训练
        if load_model:
            try:
                self.agent.load_models()
                logger.info("成功加载现有模型")
            except Exception as e:
                logger.warning(f"加载模型失败: {e}，将重新训练")
                # 删除可能损坏的模型文件
                self._remove_model_files()
        
        # Track current game state
        self.current_opponent_id = None
        self.current_state = None
        self.current_action = None
        self.current_action_prob = None
        self.current_value = None
        self.current_round = 0
        
        # Track opponent types
        self.opponent_types = {}
        
        # Track consecutive actions
        self.consecutive_cooperate = {}
        self.consecutive_betray = {}
    
    def connect(self) -> bool:
        """Connect to the game server.
        
        Returns:
            bool: Whether the connection was successful
        """
        # 先尝试断开现有连接
        try:
            self.client.disconnect()
            logger.info("已断开现有连接")
            time.sleep(1)  # 等待服务器处理断开连接
        except Exception as e:
            logger.warning(f"断开连接时出错: {e}")
        
        # 然后尝试连接
        return self.client.connect()
    
    def get_state(self, opponent_id: str, round_num: int, history: List[str]) -> np.ndarray:
        """Get the current state representation for the RL agent.
        
        Args:
            opponent_id: The ID of the opponent
            round_num: The current round number
            history: The history of opponent choices
            
        Returns:
            np.ndarray: The state representation
        """
        # Calculate cooperation and betrayal rates
        if not history:
            cooperate_rate = 0.5  # Initial assumption
            betray_rate = 0.5
            consecutive_cooperate = 0
            consecutive_betray = 0
        else:
            cooperate_rate = history.count('cooperate') / len(history)
            betray_rate = history.count('betray') / len(history)
            
            # Calculate consecutive actions
            consecutive_cooperate = 0
            consecutive_betray = 0
            for choice in reversed(history):
                if choice == 'cooperate':
                    consecutive_cooperate += 1
                    consecutive_betray = 0
                else:  # betray
                    consecutive_betray += 1
                    consecutive_cooperate = 0
                    
                # Only count the most recent streak
                if consecutive_cooperate > 0 and consecutive_betray > 0:
                    break
        
        # Update tracking dictionaries
        self.consecutive_cooperate[opponent_id] = consecutive_cooperate
        self.consecutive_betray[opponent_id] = consecutive_betray
        
        # Determine if this is the last round (or close to it)
        is_last_round = 1.0 if round_num >= self.client.max_rounds - 1 else 0.0
        
        # Normalize round number
        normalized_round = round_num / self.client.max_rounds
        
        # 创建状态向量 - 只保留前6个特征，与self.state_dim=6匹配
        state = np.array([
            normalized_round,
            cooperate_rate,
            betray_rate,
            min(consecutive_cooperate, 5) / 5.0,
            min(consecutive_betray, 5) / 5.0,
            is_last_round
            # 移除额外的特征，使维度与模型匹配
            # cooperate_rate - betray_rate,
            # 1.0 if len(history) > 0 and history[-1] == 'cooperate' else 0.0,
            # 1.0 if len(history) > 1 and history[-2] == 'cooperate' else 0.0,
            # self.get_player_cooperate_rate(opponent_id),
        ], dtype=np.float32)
        
        return state
    
    def get_player_cooperate_rate(self, opponent_id: str) -> float:
        """获取玩家对特定对手的合作率"""
        # 修复：使用 player_choices 而不是 player_history
        # TrustPVPClient 可能使用不同的属性名来存储玩家历史
        if not hasattr(self.client, 'player_history'):
            # 如果 player_history 不存在，尝试创建它
            self.client.player_history = {}
            
        if opponent_id not in self.client.player_history:
            return 0.5
        
        history = self.client.player_history[opponent_id]
        if not history:
            return 0.5
            
        return history.count('cooperate') / len(history)
    
    def identify_opponent_type(self, opponent_id: str, history: List[str]) -> str:
        """Identify the type of opponent based on their history.
        
        Args:
            opponent_id: The ID of the opponent
            history: The history of opponent choices
            
        Returns:
            str: The identified opponent type
        """
        if not history or len(history) < 3:
            return 'unknown'
        
        cooperate_rate = history.count('cooperate') / len(history)
        consecutive_cooperate = self.consecutive_cooperate.get(opponent_id, 0)
        consecutive_betray = self.consecutive_betray.get(opponent_id, 0)
        
        if cooperate_rate > 0.8:
            opponent_type = 'cooperative'
        elif cooperate_rate < 0.2:
            opponent_type = 'hostile'
        elif consecutive_cooperate >= 3:
            opponent_type = 'forgiving'
        elif consecutive_betray >= 3:
            opponent_type = 'vengeful'
        elif 0.4 <= cooperate_rate <= 0.6:
            # Check for tit-for-tat pattern
            tit_for_tat_count = 0
            for i in range(1, len(history)):
                if history[i] == self.get_action_name(i-1):
                    tit_for_tat_count += 1
            
            if tit_for_tat_count / (len(history) - 1) > 0.7:
                opponent_type = 'tit_for_tat'
            else:
                opponent_type = 'random'
        else:
            opponent_type = 'mixed'
        
        # Store the opponent type
        self.opponent_types[opponent_id] = opponent_type
        self.logger.log_opponent_type(opponent_id, opponent_type)
        
        return opponent_type
    
    def get_action_name(self, action: int) -> str:
        """Convert action index to action name.
        
        Args:
            action: The action index (0=cooperate, 1=betray)
            
        Returns:
            str: The action name
        """
        return 'cooperate' if action == 0 else 'betray'
    
    def make_decision(self, opponent_id: str, opponent_name: str, 
                      history: List[str], round_num: int) -> None:
        """Make a decision using the RL agent.
        
        Args:
            opponent_id: The ID of the opponent
            opponent_name: The name of the opponent
            history: The history of opponent choices
            round_num: The current round number
        """
        self.current_opponent_id = opponent_id
        self.current_round = round_num
        
        # Log game start if this is the first round
        if round_num == 1:
            self.logger.log_game_start(opponent_id, opponent_name)
        
        # 获取状态表示
        state = self.get_state(opponent_id, round_num, history)
        self.current_state = state
        
        # 识别对手类型
        opponent_type = 'unknown'
        if opponent_id in self.client.opponent_history:
            opponent_type = self.identify_opponent_type(opponent_id, self.client.opponent_history[opponent_id])
        
        # 使用智能体选择动作
        action, action_prob, value = self.agent.choose_action(state)
        
        # 根据对手类型和游戏阶段调整策略
        action = self.adjust_strategy(action, opponent_type, round_num, history)
        
        # 存储当前动作信息
        self.current_action = action
        self.current_action_prob = action_prob
        self.current_value = value
        
        # Convert action to choice
        choice = self.get_action_name(action)
        
        # Log the decision
        self.logger.log_decision(round_num, state, action, action_prob)
        
        # Make the choice
        self.client.make_choice(choice)
    
    def adjust_strategy(self, action: int, opponent_type: str, round_num: int, history: List[str]) -> int:
        """根据对手类型和游戏阶段调整策略"""
        # 游戏末期策略
        if round_num >= self.client.max_rounds - 2:
            return 1  # 在最后几轮选择背叛
        
        # 根据对手类型调整
        if opponent_type == 'cooperative':
            # 对合作型对手，大部分时间合作，偶尔背叛
            if round_num > 5 and np.random.random() < 0.2:
                return 1  # 背叛
            return 0  # 合作
        
        elif opponent_type == 'hostile':
            # 对敌对型对手，主要背叛
            return 1
        
        elif opponent_type == 'tit_for_tat':
            # 对TFT类型，使用修改版TFT策略
            if not history:
                return 0  # 首轮合作
            if history[-1] == 'cooperate':
                return 0  # 对方上轮合作，我方合作
            return 1  # 对方上轮背叛，我方背叛
        
        # 默认返回原始动作
        return action
    
    def calculate_reward(self, player_choice: str, opponent_choice: str, score: int) -> float:
        """计算强化学习智能体的奖励。
        
        Args:
            player_choice: 玩家的选择
            opponent_choice: 对手的选择
            score: 本轮获得的分数
            
        Returns:
            float: 计算的奖励
        """
        # 基础奖励是分数
        reward = float(score)
        
        # 对于互相合作的情况给予更高奖励（长期利益）
        if player_choice == 'cooperate' and opponent_choice == 'cooperate':
            reward += 1.0  # 增加建立信任的奖励
        
        # 对于被利用的情况给予更大惩罚
        if player_choice == 'cooperate' and opponent_choice == 'betray':
            reward -= 1.5  # 增加被利用的惩罚
        
        # 根据对手类型调整奖励
        opponent_type = self.opponent_types.get(self.current_opponent_id, 'unknown')
        if opponent_type == 'cooperative' and player_choice == 'betray':
            reward -= 1.0  # 对合作型对手背叛的惩罚
        elif opponent_type == 'hostile' and player_choice == 'cooperate':
            reward -= 0.5  # 对敌对型对手合作的惩罚
        elif opponent_type == 'tit_for_tat':
            # 对TFT类型，鼓励合作
            if player_choice == 'cooperate':
                reward += 0.5
        
        # 考虑游戏阶段
        if self.current_round >= self.client.max_rounds - 3:
            # 在游戏末期，背叛可能更有利
            if player_choice == 'betray':
                reward += 0.5
        
        # 归一化奖励
        reward = reward / 5.0
        
        return reward
    
    def process_game_state(self, state):
        if self.debug_state:
            logging.debug(f"Game state: {state}")
        
        # 安全地获取 globalRewards，如果不存在则使用默认值
        # 完全移除对 globalRewards 的访问，因为它似乎不是必需的
        # 或者如果需要，可以使用 state.get() 方法安全地获取
        # global_rewards = state.get('globalRewards', 0)


    def process_round_result(self, opponent_id: str, opponent_name: str, 
                            opponent_choice: str, score: int, total_score: int) -> None:
        """Process the result of a round.
        
        Args:
            opponent_id: The ID of the opponent
            opponent_name: The name of the opponent
            opponent_choice: The choice made by the opponent
            score: The score earned in this round
            total_score: The total score so far
        """
        if self.current_state is None or self.current_action is None:
            logger.warning("No current state or action found, skipping learning")
            return


        # Get player's choice
        player_choice = self.get_action_name(self.current_action)
        
        # Calculate reward
        reward = self.calculate_reward(player_choice, opponent_choice, score)
        
        # Determine if this is the terminal state
        done = (self.current_round >= self.client.max_rounds)
        
        # 添加经验回放缓冲区
        self.replay_buffer = []
        self.replay_buffer_size = 10000
        
        # 将经验添加到回FFER缓冲区
        experience = (
            self.current_state,
            self.current_action,
            self.current_action_prob,
            self.current_value,
            reward,
            done
        )
        self.replay_buffer.append(experience)
        
        # 限制缓冲区大小
        if len(self.replay_buffer) > self.replay_buffer_size:
            self.replay_buffer.pop(0)
        
        # Log round result
        self.logger.log_round_result(
            self.current_round,
            player_choice,
            opponent_choice,
            score,
            reward
        )
        
        # Identify opponent type
        if opponent_id in self.client.opponent_history:
            history = self.client.opponent_history[opponent_id]
            self.identify_opponent_type(opponent_id, history)
        
        # Learn from experience if we have enough samples
        if done and len(self.agent.memory.states) > 0:
            self.agent.learn()
    
    def process_game_end(self, final_score: int, history: List[Dict], 
                         rounds: int, message: str) -> None:
        """Process the end of a game.
        
        Args:
            final_score: The final score
            history: The game history
            rounds: The number of rounds played
            message: The end game message
        """
        # Log game end
        self.logger.log_game_end(
            final_score,
            rounds,
            self.current_opponent_id,
            self.client.current_opponent_name
        )
        
        # Increment games played counter
        self.games_played += 1
        
        # Save model periodically
        if self.games_played % self.save_interval == 0:
            self.agent.save_models()
            logger.info(f"Model saved after {self.games_played} games")
    
    def run(self) -> None:
        """运行机器人。"""
        try:
            # 强制重新训练
            logger.info("开始自我对弈训练...")
            self.self_play_training(episodes=10000)
            logger.info("自我对弈训练完成")
            
            # 连接到服务器
            if not self.connect():
                logger.error("无法连接到服务器")
                return
            
            self.client.join_game()
            logger.info("加入游戏")

            time.sleep(3)
            # 等待游戏结束
            while self.client.is_in_game:
                time.sleep(1)
                
            logger.info("游戏已结束，机器人将退出")
            
        except KeyboardInterrupt:
            logger.info("Bot stopped by user")
        except Exception as e:
            logger.exception(f"Error running bot: {e}")
        finally:
            # Save model before exiting
            self.agent.save_models()
            logger.info("Model saved before exit")
            
            # Disconnect from server
            self.client.disconnect()
    
    def self_play_training(self, episodes=1000):
        """通过自我对弈进行训练"""
        # 记录训练开始时间
        start_time = time.time()
        
        for episode in range(episodes):
            # 模拟一场游戏
            for round_num in range(1, 11):  # 假设10轮游戏
                # 创建更有意义的状态，而不是完全随机
                # 使用更接近真实游戏的状态分布
                normalized_round = round_num / 10.0
                cooperate_rate = np.random.beta(2, 2)  # Beta分布更符合真实合作率分布
                betray_rate = 1.0 - cooperate_rate
                consecutive_cooperate = min(np.random.geometric(0.5) - 1, 5) / 5.0
                consecutive_betray = min(np.random.geometric(0.5) - 1, 5) / 5.0
                is_last_round = 1.0 if round_num >= 9 else 0.0
                
                state1 = np.array([
                    normalized_round,
                    cooperate_rate,
                    betray_rate,
                    consecutive_cooperate,
                    consecutive_betray,
                    is_last_round
                ], dtype=np.float32)
                
                # 为对手创建略有不同的状态
                state2 = state1.copy()
                state2[1:3] = state1[2:0:-1]  # 交换合作率和背叛率
                
                # 玩家1选择动作
                action1, prob1, value1 = self.agent.choose_action(state1)
                
                # 玩家2选择动作
                action2, prob2, value2 = self.agent.choose_action(state2)
                
                # 计算奖励
                choice1 = self.get_action_name(action1)
                choice2 = self.get_action_name(action2)
                
                # 根据囚徒困境规则计算奖励
                if choice1 == 'cooperate' and choice2 == 'cooperate':
                    reward1, reward2 = 3, 3
                elif choice1 == 'cooperate' and choice2 == 'betray':
                    reward1, reward2 = 0, 5
                elif choice1 == 'betray' and choice2 == 'cooperate':
                    reward1, reward2 = 5, 0
                else:  # 都背叛
                    reward1, reward2 = 1, 1
                
                # 归一化奖励
                reward1, reward2 = reward1 / 5.0, reward2 / 5.0
                
                # 存储经验
                done = (round_num == 10)
                self.agent.remember(state1, action1, prob1, value1, reward1, done)
                self.agent.remember(state2, action2, prob2, value2, reward2, done)
                
                # 更频繁地学习
                if done:
                    self.agent.learn()
            
            # 定期保存模型和报告进度
            if episode % 100 == 0:
                self.agent.save_models()
                elapsed_time = time.time() - start_time
                eta = (elapsed_time / (episode + 1)) * (episodes - episode - 1)
                logger.info(f"自我对弈训练：已完成 {episode}/{episodes} 轮 "
                           f"({episode/episodes*100:.1f}%) - 已用时间: {elapsed_time/60:.1f}分钟 - "
                           f"预计剩余时间: {eta/60:.1f}分钟")


    def _remove_model_files(self):
        """删除现有模型文件"""
        try:
            model_files = [
                'models/ppo_actor.pth',
                'models/ppo_critic.pth',
                'models/actor_torch_ppo',
                'models/critic_torch_ppo'
            ]
            for file in model_files:
                if os.path.exists(file):
                    os.remove(file)
                    logger.info(f"已删除模型文件: {file}")
        except Exception as e:
            logger.warning(f"删除模型文件时出错: {e}")

