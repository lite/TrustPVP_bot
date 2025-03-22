import logging
import time
import random  # 添加 random 模块导入
import socketio
from typing import Dict, List, Callable
import time
import logging
from typing import Dict, List, Optional, Callable, Any, Union

class TrustPVPClient:
    """Socket.IO client for the Trust PVP game."""
    
    def __init__(self, server_url: str, player_name: str):
        """Initialize the client with server URL and player name.
        
        Args:
            server_url: The URL of the game server
            player_name: The name of the player
        """
        self.server_url = server_url
        self.player_name = player_name
        self.player_id = None
        self.is_in_game = False
        self.current_opponent_id = ''
        self.current_opponent_name = ''
        
        # Game state tracking
        self.opponent_history = {}
        self.round_counter = {}
        self.max_rounds = 20
        
        # Initialize Socket.IO client
        self.sio = socketio.Client()
        self._setup_event_handlers()
        
        # Callbacks
        self.on_decision_needed = None
        self.on_round_complete = None
        self.on_game_end = None
        
    def _setup_event_handlers(self):
        """Set up Socket.IO event handlers."""
        # Connection events
        self.sio.on('connect', self._on_connect)
        self.sio.on('connect_error', self._on_connect_error)
        self.sio.on('disconnect', self._on_disconnect)
        
        # Reconnection events
        self.sio.on('reconnect_attempt', self._on_reconnect_attempt)
        self.sio.on('reconnect', self._on_reconnect)
        
        # Game events
        self.sio.on('loginSuccess', self._on_login_success)
        self.sio.on('gameJoined', self._on_game_joined)
        self.sio.on('matchFound', self._on_match_found)
        self.sio.on('roundComplete', self._on_round_complete)
        self.sio.on('gameEnd', self._on_game_end)
        self.sio.on('opponentDisconnected', self._on_opponent_disconnected)
        self.sio.on('error', self._on_error)
    
    def connect(self):
        """Connect to the game server."""
        try:
            self.sio.connect(
                self.server_url,
                transports=['websocket'],
                wait=True,
                wait_timeout=10,
                socketio_path='socket.io',
                headers={}
            )
            return True
        except Exception as e:
            logging.error(f"Connection error: {e}")
            return False
    
    def disconnect(self):
        """Disconnect from the game server."""
        if self.sio.connected:
            self.sio.disconnect()
            logging.info("Disconnected from server")
    
    def login(self):
        """Login to the game server."""
        # 生成随机时间戳后缀，确保总长度不超过15个字符
        timestamp = int(time.time()) % 10000  # 只取时间戳的后4位数字
        random_suffix = int(random.random() * 100)  # 只使用2位随机数
        
        # 计算可用于原始用户名的最大长度
        max_name_length = 15 - len(f"_{timestamp}_{random_suffix}")
        
        # 如果原始用户名过长，则截断
        base_name = self.player_name[:max_name_length]
        player_name_with_timestamp = f"{base_name}_{timestamp}_{random_suffix}"
        
        login_data = {
            'playerName': player_name_with_timestamp
        }
        if self.player_id:
            login_data['playerId'] = self.player_id
        
        self.sio.emit('login', login_data)
        logging.info(f"Login attempt with name: {player_name_with_timestamp}")
    
    def join_game(self):
        """Join a game."""
        if not self.is_in_game:
            self.login();   
            
            # 延迟一小段时间后再加入游戏，确保登录请求已处理
            time.sleep(0.5)
            self.sio.emit('joinGame')
            logging.info("Attempting to join game")
    
    def make_choice(self, choice: str):
        """Make a choice (cooperate or betray).
        
        Args:
            choice: Either 'cooperate' or 'betray'
        """
        if choice not in ['cooperate', 'betray']:
            logging.error(f"Invalid choice: {choice}. Must be 'cooperate' or 'betray'")
            return
        
        self.sio.emit('makeChoice', choice)
        logging.info(f"Made choice: {choice}")
    
    def get_leaderboard(self, callback: Callable[[Dict], None]):
        """Get the leaderboard data.
        
        Args:
            callback: Function to call with leaderboard data
        """
        def on_leaderboard(data):
            callback(data)
        
        self.sio.emit('getLeaderboard')
        self.sio.once('leaderboardData', on_leaderboard)
    
    def get_player_stats(self, callback: Callable[[Dict], None]):
        """Get player statistics.
        
        Args:
            callback: Function to call with player stats data
        """
        def on_stats(data):
            callback(data)
        
        self.sio.emit('getPlayerStats')
        self.sio.once('playerStats', on_stats)
    
    # Socket.IO event handlers
    def _on_connect(self):
        logging.info("Connected to server")
        # self.login()
    
    def _on_connect_error(self, error):
        logging.error(f"Connection error: {error}")
    
    def _on_disconnect(self, reason):
        logging.info(f"Disconnected: {reason}")
        self.is_in_game = False
    
    def _on_reconnect_attempt(self, attempt):
        logging.info(f"Reconnection attempt: {attempt}")
    
    def _on_reconnect(self):
        logging.info("Reconnected to server")
        if self.player_id:
            self.login()
    
    def _on_login_success(self, data):
        self.player_id = data['playerData']['id']
        is_new_player = data['isNewPlayer']
        logging.info(f"Login successful: {'New player' if is_new_player else 'Returning player'}")
        
    def _on_game_joined(self, data):
        self.is_in_game = True
        global_rewards = data['globalRewards']
        logging.info(f"Joined game. Global rewards: {global_rewards}")
        
        # Reset round counter for new game
        if self.current_opponent_id:
            self.round_counter[self.current_opponent_id] = 1
    
    def _on_match_found(self, data):
        opponent_id = data['opponent']
        opponent_name = data['opponentName']
        
        self.current_opponent_id = opponent_id
        self.current_opponent_name = opponent_name
        
        logging.info(f"Matched with opponent: {opponent_name} (ID: {opponent_id})")
        
        # Initialize opponent history if not exists
        if opponent_id not in self.opponent_history:
            self.opponent_history[opponent_id] = []
        
        # Initialize round counter if not exists
        if opponent_id not in self.round_counter:
            self.round_counter[opponent_id] = 1
        
        # Call decision callback if set
        if self.on_decision_needed:
            history = self.opponent_history.get(opponent_id, [])
            round_num = self.round_counter.get(opponent_id, 1)
            self.on_decision_needed(opponent_id, opponent_name, history, round_num)
    
    def _on_round_complete(self, data):
        score = data['score']
        total_score = data['totalScore']
        opponent_choice = data['opponentChoice']
        opponent_name = data['opponentName']
        opponent_id = data.get('opponent', self.current_opponent_id)
        opponent_score = data.get('opponentScore', 0)
        
        logging.info(f"Round complete - Score: {score}, Total: {total_score}")
        logging.info(f"Opponent {opponent_name} chose: {opponent_choice}")
        
        # Record opponent choice
        if opponent_id:
            if opponent_id not in self.opponent_history:
                self.opponent_history[opponent_id] = []
            
            self.opponent_history[opponent_id].append(opponent_choice)
            
            # Keep history limited to last 20 choices
            if len(self.opponent_history[opponent_id]) > 20:
                self.opponent_history[opponent_id].pop(0)
            
            # Increment round counter
            current_round = self.round_counter.get(opponent_id, 1)
            self.round_counter[opponent_id] = current_round + 1
        
        # Call round complete callback if set
        if self.on_round_complete:
            self.on_round_complete(opponent_id, opponent_name, opponent_choice, score, total_score)
        
        # Join next game after a short delay
        time.sleep(1)
        if self.sio.connected:
            self.join_game()
    
    def _on_game_end(self, data):
        """处理游戏结束事件。"""
        logging.info(f"游戏结束: {data.get('message', '')}")
        logging.info(f"最终得分: {data.get('finalScore', 0)}, 总回合数: {data.get('rounds', 0)}")
        
        # 调用回调函数
        if self.on_game_end:
            self.on_game_end(
                data.get('finalScore', 0),
                data.get('history', []),
                data.get('rounds', 0),
                data.get('message', '')
            )
        
        self.is_in_game = False
        
        # Join next game after a short delay
        time.sleep(2)
        if self.sio.connected:
            self.join_game()
    
    def _on_opponent_disconnected(self, data):
        message = data['message']
        logging.info(f"Opponent disconnected: {message}")
        
        self.is_in_game = False
        
        # Join next game after a short delay
        time.sleep(1)
        if self.sio.connected:
            self.join_game()
    
    def _on_error(self, data):
        message = data['message']
        logging.error(f"Error: {message}")