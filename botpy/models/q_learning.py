import numpy as np
import os
import pickle
from typing import Dict, List, Tuple, Optional

class QLearningAgent:
    """Q-Learning agent for the Trust PVP game."""
    
    def __init__(self, learning_rate=0.1, discount_factor=0.95, exploration_rate=1.0,
                 exploration_decay=0.995, min_exploration_rate=0.01):
        """Initialize the Q-Learning agent.
        
        Args:
            learning_rate: Alpha - learning rate for Q-value updates
            discount_factor: Gamma - discount factor for future rewards
            exploration_rate: Epsilon - initial exploration rate
            exploration_decay: Rate at which exploration decreases
            min_exploration_rate: Minimum exploration rate
        """
        self.learning_rate = learning_rate
        self.discount_factor = discount_factor
        self.exploration_rate = exploration_rate
        self.exploration_decay = exploration_decay
        self.min_exploration_rate = min_exploration_rate
        
        # Q-table: state -> [q_value_cooperate, q_value_betray]
        self.q_table = {}
        
        # State encoding parameters
        self.round_bins = 5  # Discretize round number
        self.rate_bins = 5   # Discretize cooperation/betrayal rates
        self.streak_bins = 3  # Discretize consecutive actions
        
        # Training metrics
        self.training_rewards = []
    
    def get_state_key(self, state: np.ndarray) -> str:
        """Convert continuous state to discrete state key for Q-table.
        
        Args:
            state: Numpy array with state features
                [round_num, cooperate_rate, betray_rate, 
                 consecutive_cooperate, consecutive_betray, is_last_round]
                
        Returns:
            str: Discretized state key for Q-table
        """
        # Discretize each feature
        round_num = min(int(state[0] * self.round_bins), self.round_bins - 1)
        coop_rate = min(int(state[1] * self.rate_bins), self.rate_bins - 1)
        betray_rate = min(int(state[2] * self.rate_bins), self.rate_bins - 1)
        consec_coop = min(int(state[3] * self.streak_bins), self.streak_bins - 1)
        consec_betray = min(int(state[4] * self.streak_bins), self.streak_bins - 1)
        is_last_round = 1 if state[5] > 0.5 else 0
        
        # Create state key
        return f"{round_num}_{coop_rate}_{betray_rate}_{consec_coop}_{consec_betray}_{is_last_round}"
    
    def get_q_values(self, state: np.ndarray) -> np.ndarray:
        """Get Q-values for a given state.
        
        Args:
            state: The state vector
            
        Returns:
            np.ndarray: Q-values for each action [cooperate, betray]
        """
        state_key = self.get_state_key(state)
        
        # If state not in Q-table, initialize with zeros
        if state_key not in self.q_table:
            self.q_table[state_key] = np.zeros(2)
            
        return self.q_table[state_key]
    
    def choose_action(self, state: np.ndarray) -> Tuple[int, float]:
        """Choose an action using epsilon-greedy policy.
        
        Args:
            state: The state vector
            
        Returns:
            Tuple[int, float]: (action, q_value)
                action: 0 for cooperate, 1 for betray
                q_value: Q-value for the chosen action
        """
        # Exploration: random action
        if np.random.random() < self.exploration_rate:
            action = np.random.choice([0, 1])
            q_values = self.get_q_values(state)
            return action, q_values[action]
        
        # Exploitation: best action
        q_values = self.get_q_values(state)
        action = np.argmax(q_values)
        return action, q_values[action]
    
    def update(self, state: np.ndarray, action: int, reward: float, 
               next_state: np.ndarray, done: bool) -> None:
        """Update Q-values using the Q-learning update rule.
        
        Args:
            state: Current state
            action: Action taken (0=cooperate, 1=betray)
            reward: Reward received
            next_state: Next state
            done: Whether this is a terminal state
        """
        state_key = self.get_state_key(state)
        
        # Initialize state if not in Q-table
        if state_key not in self.q_table:
            self.q_table[state_key] = np.zeros(2)
        
        # Get current Q-value
        current_q = self.q_table[state_key][action]
        
        # Get max Q-value for next state
        if done:
            max_next_q = 0
        else:
            next_q_values = self.get_q_values(next_state)
            max_next_q = np.max(next_q_values)
        
        # Q-learning update rule
        new_q = current_q + self.learning_rate * (
            reward + self.discount_factor * max_next_q - current_q)
        
        # Update Q-table
        self.q_table[state_key][action] = new_q
        
        # Decay exploration rate
        self.exploration_rate = max(
            self.min_exploration_rate, 
            self.exploration_rate * self.exploration_decay
        )
        
        # Track reward for metrics
        self.training_rewards.append(reward)
    
    def save_model(self, path='models'):
        """Save the Q-table to a file.
        
        Args:
            path: Directory to save the model
        """
        os.makedirs(path, exist_ok=True)
        with open(f'{path}/q_table.pkl', 'wb') as f:
            pickle.dump(self.q_table, f)
        print(f"Q-table saved with {len(self.q_table)} states")
    
    def load_model(self, path='models'):
        """Load the Q-table from a file.
        
        Args:
            path: Directory to load the model from
            
        Returns:
            bool: Whether the model was loaded successfully
        """
        try:
            with open(f'{path}/q_table.pkl', 'rb') as f:
                self.q_table = pickle.load(f)
            print(f"Q-table loaded with {len(self.q_table)} states")
            return True
        except FileNotFoundError:
            print("No saved Q-table found, starting fresh")
            return False
    
    def get_action_probabilities(self, state: np.ndarray) -> np.ndarray:
        """Get action probabilities based on Q-values.
        
        Args:
            state: The state vector
            
        Returns:
            np.ndarray: Probability distribution over actions
        """
        q_values = self.get_q_values(state)
        
        # Apply softmax to convert Q-values to probabilities
        exp_q = np.exp(q_values - np.max(q_values))  # Subtract max for numerical stability
        probabilities = exp_q / np.sum(exp_q)
        
        return probabilities
    
    def get_metrics(self):
        """Get training metrics.
        
        Returns:
            Dict: Dictionary of training metrics
        """
        return {
            'q_table_size': len(self.q_table),
            'exploration_rate': self.exploration_rate,
            'avg_reward_last_100': np.mean(self.training_rewards[-100:]) if len(self.training_rewards) > 0 else 0
        }