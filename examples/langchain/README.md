# LangChain + ACP

Run any LangChain agent with ACP consent enforcement:

```bash
acp init --channel=telegram
acp contain -- python agent.py
```

All shell commands and HTTP requests from the agent are intercepted by ACP. Your Telegram bot will prompt you to approve or deny each action.

See `agent.py` for a complete example.
