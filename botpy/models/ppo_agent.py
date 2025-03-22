import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
from torch.distributions import Categorical

class PPOMemory:
    def __init__(self):
        self.states = []
        self.actions = []
        self.probs = []
        self.vals = []
        self.rewards = []
        self.dones = []

    def store_memory(self, state, action, probs, vals, reward, done):
        self.states.append(state)
        self.actions.append(action)
        self.probs.append(probs)
        self.vals.append(vals)
        self.rewards.append(reward)
        self.dones.append(done)

    def clear_memory(self):
        self.states = []
        self.actions = []
        self.probs = []
        self.vals = []
        self.rewards = []
        self.dones = []

    def generate_batches(self):
        return np.array(self.states), \
               np.array(self.actions), \
               np.array(self.probs), \
               np.array(self.vals), \
               np.array(self.rewards), \
               np.array(self.dones)


class ActorNetwork(nn.Module):
    def __init__(self, input_dims, n_actions, alpha=0.0003):
        super(ActorNetwork, self).__init__()
        
        self.actor = nn.Sequential(
            nn.Linear(input_dims, 64),
            nn.ReLU(),
            nn.Linear(64, 64),
            nn.ReLU(),
            nn.Linear(64, n_actions),
            nn.Softmax(dim=-1)
        )
        
        self.optimizer = optim.Adam(self.parameters(), lr=alpha)
        self.device = torch.device('cuda:0' if torch.cuda.is_available() else 'cpu')
        self.to(self.device)
    
    def forward(self, state):
        dist = self.actor(state)
        dist = Categorical(dist)
        
        return dist


class CriticNetwork(nn.Module):
    def __init__(self, input_dims, alpha=0.0003):
        super(CriticNetwork, self).__init__()
        
        self.critic = nn.Sequential(
            nn.Linear(input_dims, 64),
            nn.ReLU(),
            nn.Linear(64, 64),
            nn.ReLU(),
            nn.Linear(64, 1)
        )
        
        self.optimizer = optim.Adam(self.parameters(), lr=alpha)
        self.device = torch.device('cuda:0' if torch.cuda.is_available() else 'cpu')
        self.to(self.device)
    
    def forward(self, state):
        value = self.critic(state)
        
        return value


class PPOAgent:
    def __init__(self, input_dims, n_actions=2, gamma=0.99, alpha=0.0003, 
                 gae_lambda=0.95, policy_clip=0.2, batch_size=64, n_epochs=10):
        self.gamma = gamma
        self.policy_clip = policy_clip
        self.n_epochs = n_epochs
        self.gae_lambda = gae_lambda
        self.batch_size = batch_size
        
        self.actor = ActorNetwork(input_dims, n_actions, alpha)
        self.critic = CriticNetwork(input_dims, alpha)
        self.memory = PPOMemory()
        
    def remember(self, state, action, probs, vals, reward, done):
        self.memory.store_memory(state, action, probs, vals, reward, done)
    
    def save_models(self, path='models'):
        torch.save(self.actor.state_dict(), f'{path}/ppo_actor.pth')
        torch.save(self.critic.state_dict(), f'{path}/ppo_critic.pth')
    
    def load_models(self, path='models'):
        try:
            self.actor.load_state_dict(torch.load(f'{path}/ppo_actor.pth'))
            self.critic.load_state_dict(torch.load(f'{path}/ppo_critic.pth'))
            print("Models loaded successfully")
            return True
        except FileNotFoundError:
            print("No saved models found, starting fresh")
            return False
    
    def choose_action(self, observation):
        state = torch.tensor([observation], dtype=torch.float).to(self.actor.device)
        
        dist = self.actor(state)
        value = self.critic(state)
        action = dist.sample()
        
        probs = torch.squeeze(dist.log_prob(action)).item()
        action = torch.squeeze(action).item()
        value = torch.squeeze(value).item()
        
        return action, probs, value
    
    def learn(self):
        for _ in range(self.n_epochs):
            state_arr, action_arr, old_probs_arr, vals_arr, reward_arr, done_arr = self.memory.generate_batches()
            
            values = vals_arr
            advantage = np.zeros(len(reward_arr), dtype=np.float32)
            
            for t in range(len(reward_arr)-1):
                discount = 1
                a_t = 0
                for k in range(t, len(reward_arr)-1):
                    a_t += discount * (reward_arr[k] + self.gamma * values[k+1] * (1-int(done_arr[k])) - values[k])
                    discount *= self.gamma * self.gae_lambda
                advantage[t] = a_t
            
            advantage = torch.tensor(advantage).to(self.actor.device)
            values = torch.tensor(values).to(self.actor.device)
            
            for batch in range(0, len(state_arr), self.batch_size):
                states = torch.tensor(state_arr[batch:batch+self.batch_size], dtype=torch.float).to(self.actor.device)
                old_probs = torch.tensor(old_probs_arr[batch:batch+self.batch_size]).to(self.actor.device)
                actions = torch.tensor(action_arr[batch:batch+self.batch_size]).to(self.actor.device)
                
                dist = self.actor(states)
                critic_value = self.critic(states)
                critic_value = torch.squeeze(critic_value)
                
                new_probs = dist.log_prob(actions)
                prob_ratio = new_probs.exp() / old_probs.exp()
                weighted_probs = advantage[batch:batch+self.batch_size] * prob_ratio
                weighted_clipped_probs = torch.clamp(prob_ratio, 1-self.policy_clip, 1+self.policy_clip) * \
                                         advantage[batch:batch+self.batch_size]
                
                actor_loss = -torch.min(weighted_probs, weighted_clipped_probs).mean()
                
                returns = advantage[batch:batch+self.batch_size] + values[batch:batch+self.batch_size]
                critic_loss = (returns-critic_value)**2
                critic_loss = critic_loss.mean()
                
                total_loss = actor_loss + 0.5 * critic_loss
                
                self.actor.optimizer.zero_grad()
                self.critic.optimizer.zero_grad()
                total_loss.backward()
                self.actor.optimizer.step()
                self.critic.optimizer.step()
        
        self.memory.clear_memory()