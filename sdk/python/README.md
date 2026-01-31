# acp-sdk

**2FA for AI Agents.** Add human approval to any Python function in 3 lines.

```bash
pip install acp-sdk
```

```python
from acp import requires_consent

@requires_consent("high")
def send_email(to, subject, body):
    ...
```

Zero dependencies. Zero config. [Full documentation →](https://github.com/agent-consent-protocol/acp)
