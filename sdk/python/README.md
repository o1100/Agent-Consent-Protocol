# ACP Python SDK

**2FA for AI Agents** — Add human consent to any AI agent in 2 lines of code.

```python
from acp import requires_consent

@requires_consent("high")
def send_email(to, body):
    ...
```

## Install

```bash
pip install acp-sdk              # Zero deps (local terminal prompt)
pip install acp-sdk[remote]      # + requests (Telegram/Gateway mode)
pip install acp-sdk[all]         # + rich + cryptography
```

## Documentation

See the [main README](../../README.md) and [integration guide](../../docs/integration-guide.md).
