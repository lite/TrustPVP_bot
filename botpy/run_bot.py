#!/usr/bin/env python
# -*- coding: utf-8 -*-

import argparse
import logging
import sys
from bot_rl import TrustPVPRLBot

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Trust PVP Reinforcement Learning Bot')
    parser.add_argument('--server', type=str, default='http://118.123.202.87:13001',
                        help='Server URL')
    parser.add_argument('--name', type=str, default='botpy_v2',
                        help='Player name')
    parser.add_argument('--no-load', action='store_true',
                        help='Do not load saved model')
    parser.add_argument('--save-interval', type=int, default=10,
                        help='How often to save the model (in games)')
    parser.add_argument('--log-level', type=str, choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'], 
                        default='INFO', help='Logging level')
    parser.add_argument('--debug-state', action='store_true',
                        help='Print game state for debugging')
    
    args = parser.parse_args()
    
    # Configure logging
    log_level = getattr(logging, args.log_level)
    logging.basicConfig(level=log_level, 
                        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    try:
        # Create and run the bot
        bot = TrustPVPRLBot(
            server_url=args.server,
            player_name=args.name,
            load_model=not args.no_load,
            save_interval=args.save_interval,
            debug_state=args.debug_state
        )
        
        print(f"Starting Trust PVP RL Bot with name: {args.name}")
        print(f"Connecting to server: {args.server}")
        print("Press Ctrl+C to exit")
        
        bot.run()
    except KeyboardInterrupt:
        print("\nBot stopped by user")
        sys.exit(0)
    except Exception as e:
        logging.exception(f"Error running bot: {e}")
        sys.exit(1)