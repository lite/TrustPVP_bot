import logging
import os
import time
import matplotlib.pyplot as plt
import numpy as np
from typing import Dict, List, Tuple

class BotLogger:
    """Logger for the Trust PVP RL Bot."""
    
    def __init__(self, log_dir='logs'):
        """Initialize the logger.
        
        Args:
            log_dir: Directory to store logs and plots
        """
        # Create log directory if it doesn't exist
        os.makedirs(log_dir, exist_ok=True)
        
        # Set up file logger
        self.log_file = os.path.join(log_dir, f'bot_{int(time.time())}.log')
        self.logger = logging.getLogger('bot_logger')
        self.logger.setLevel(logging.INFO)
        
        # Add file handler
        file_handler = logging.FileHandler(self.log_file)
        file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
        self.logger.addHandler(file_handler)
        
        # Add console handler
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
        self.logger.addHandler(console_handler)
        
        # Performance tracking
        self.rewards = []
        self.scores = []
        self.opponent_types = {}
        self.cooperation_rates = []
        self.win_rates = []
        self.games_played = 0
        self.rounds_played = 0
        
        # Plot directory
        self.plot_dir = os.path.join(log_dir, 'plots')
        os.makedirs(self.plot_dir, exist_ok=True)
    
    def log_game_start(self, opponent_id: str, opponent_name: str):
        """Log the start of a game.
        
        Args:
            opponent_id: The ID of the opponent
            opponent_name: The name of the opponent
        """
        self.logger.info(f"Starting game against {opponent_name} (ID: {opponent_id})")
    
    def log_decision(self, round_num: int, state: np.ndarray, action: int, action_prob: float):
        """Log a decision made by the agent.
        
        Args:
            round_num: The current round number
            state: The state vector
            action: The action taken (0=cooperate, 1=betray)
            action_prob: The probability of taking the action
        """
        action_name = 'cooperate' if action == 0 else 'betray'
        self.logger.info(f"Round {round_num}: Chose {action_name} with probability {np.exp(action_prob):.4f}")
        self.logger.debug(f"State: {state}")
    
    def log_round_result(self, round_num: int, player_choice: str, opponent_choice: str, 
                         score: int, reward: float):
        """Log the result of a round.
        
        Args:
            round_num: The current round number
            player_choice: The choice made by the player
            opponent_choice: The choice made by the opponent
            score: The score earned in this round
            reward: The calculated reward
        """
        self.logger.info(f"Round {round_num} result: Player chose {player_choice}, "
                       f"Opponent chose {opponent_choice}, Score: {score}, Reward: {reward:.2f}")
        
        self.rewards.append(reward)
        self.rounds_played += 1
    
    def log_game_end(self, final_score: int, rounds: int, opponent_id: str, opponent_name: str):
        """Log the end of a game.
        
        Args:
            final_score: The final score
            rounds: The number of rounds played
            opponent_id: The ID of the opponent
            opponent_name: The name of the opponent
        """
        self.logger.info(f"Game ended against {opponent_name} after {rounds} rounds with score {final_score}")
        
        self.scores.append(final_score)
        self.games_played += 1
        
        # Generate plots every 10 games
        if self.games_played % 10 == 0:
            self.generate_plots()
    
    def log_opponent_type(self, opponent_id: str, opponent_type: str):
        pass