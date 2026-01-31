# ACP Architecture

## Design Philosophy

**Lightweight-first.** ACP scales from a single decorator with zero dependencies to a production gateway with Ed25519 crypto. You only add complexity when you need it.

## Three Tiers

```
Tier 1 — Local (Zero Config)
┌──────────┐     ┌──────────────┐     ┌──────────┐
│ AI Agent │────▶│  @requires_  │────▶│ Terminal  │
│          │     │  consent()   │     │ Prompt    │
│          │◀────│  decorator   │◀────│ [y/N]     │
└──────────┘     └──────────────┘     └──────────┘

Tier 2 — Mobile (One Env Var)
┌──────────┐     ┌──────────────┐     ┌──────────┐
│ AI Agent │────▶│  @requires_  │────▶│ Telegram  │
│          │     │  consent()   │     │ Bot API   │──▶ 📱
│          │◀────│  decorator   │◀────│           │◀── [✅][❌]
└──────────┘     └──────────────┘     └──────────┘

Tier 3 — Production (Full Security)
┌──────────┐     ┌──────────────┐     ┌──────────┐     ┌──────────┐
│ AI Agent │────▶│  @requires_  │────▶│   ACP    │────▶│ Telegram │──▶📱
│          │     │  consent()   │     │ Gateway  │     │ Webhook  │
│          │◀────│  decorator   │◀────│          │◀────│ CLI      │
└──────────┘     └──────────────┘     └──────────┘     └──────────┘
                                       │ Policy  │
                                       │ Crypto  │
                                       │ Audit   │
                                       └─────────┘
```

## Mode Auto-Detection

The SDK automatically picks the right mode based on environment variables:

```python
# No env vars → Tier 1 (terminal prompt)
# ACP_TELEGRAM_TOKEN set → Tier 2 (direct Telegram)
# ACP_GATEWAY_URL set → Tier 3 (full gateway)
```

**Same code works at every tier.** Zero code changes when upgrading.

## Built-in Tool Classification

Convention over configuration. The SDK classifies common tools automatically:

- `read_file`, `web_search` → data/low → auto-approve or quick prompt
- `send_email`, `send_sms` → communication/high → always ask
- `transfer_money`, `deploy_production` → financial/critical → always ask

Users only override when they disagree with the default.

## Gateway Components (Tier 3)

When you need production-grade security:

| Component | Purpose |
|---|---|
| **REST API** | Express server, all consent lifecycle endpoints |
| **Policy Engine** | Declarative JSON rules, hot-reloadable |
| **Consent Store** | SQLite with nonce tracking, session approvals |
| **Crypto Module** | Ed25519 signing/verification via Node.js crypto |
| **Audit Trail** | JSONL with SHA-256 hash chaining |
| **Channel Adapters** | Telegram, webhook, CLI (pluggable) |

## Security Boundaries

The critical insight: **the consent check is outside the agent's trust boundary.**

- **Tier 1**: Prompt goes to stderr, reads from stdin. Agent can't intercept.
- **Tier 2**: Telegram API is unreachable by the agent process.
- **Tier 3**: Gateway is a separate process with its own keys. Agent can't forge proofs.

## Deployment

| Scenario | Setup |
|---|---|
| Development | `pip install acp-sdk` + decorator. Done. |
| Personal/Startup | Add `ACP_TELEGRAM_TOKEN` env var. |
| Production | `npx acp-gateway` or `docker run acp-gateway` |
| Team/Enterprise | Gateway + multiple channels + policies |
