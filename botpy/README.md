# Trust PVP Reinforcement Learning Bot

这是一个基于强化学习的信任演化博弈机器人，使用Python实现。该机器人能够通过与其他玩家的交互学习最优策略，适应不同对手的行为模式。

## 项目结构

```
botpy/
├── requirements.txt    # 项目依赖
├── bot_rl.py           # 主要机器人实现
├── models/             # 强化学习模型
│   ├── ppo_agent.py    # PPO代理实现
│   └── q_learning.py   # Q-learning实现
└── utils/              # 工具函数
    ├── client.py       # Socket客户端
    └── logger.py       # 日志工具
```

## 安装

```bash
pip install -r requirements.txt
```

## 使用方法

```bash
python run_bot.py
```

## 实现细节

该机器人使用强化学习算法（PPO - Proximal Policy Optimization）来学习最优的合作/背叛策略。它通过以下方式工作：

1. 跟踪对手历史行为
2. 使用强化学习模型预测最佳行动
3. 根据游戏结果更新模型参数
4. 随着游戏进行，不断优化决策策略

机器人能够识别不同类型的对手（合作型、背叛型、随机型等），并相应地调整策略。