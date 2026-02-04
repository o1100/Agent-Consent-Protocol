# ACP v0.3.0: Agent Consent Protocol

## The Problem

AI agents (Claude Code, OpenClaw, etc.) need to take actions on your behalf — HTTP requests, API calls, file operations. Current solutions have two gaps:

1. **Static policies** — Docker Sandboxes has allow/deny lists, but no human-in-the-loop
2. **Permission fatigue** — Claude Code asks for every action, breaking flow

**The 2FA insight:** Just like authentication needs a second factor (your phone), agent actions need a second factor — human approval via push notification for sensitive operations.

## The Solution

ACP is a **consent-aware HTTP proxy** that sits in front of your agent's network traffic. For each request:

1. Check policy (allow / ask / deny)
2. If "ask" → send Telegram push notification
3. Wait for human to tap Approve or Deny
4. Forward or block the request
5. Log the decision

```
┌─────────────────────────────────────────────────────────┐
│  DOCKER SANDBOX (microVM)                               │
│  Agent runs freely inside isolated VM                   │
│  HTTP_PROXY → http://host:8444 (ACP)                    │
└─────────────────────┬───────────────────────────────────┘
                      │ All HTTP/HTTPS
                      ▼
┌─────────────────────────────────────────────────────────┐
│  ACP CONSENT PROXY                                      │
│                                                         │
│  policy.yml:                                            │
│    allow: pypi.org, *.anthropic.com                     │
│    ask: api.sendgrid.com, *.stripe.com                  │
│    deny: *.evil.com                                     │
│                                                         │
│  "ask" → Telegram notification → human approves → forward│
└─────────────────────────────────────────────────────────┘
```

## Why Build ON TOP of Docker Sandboxes

Docker released [Docker Sandboxes](https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/) — microVM-based isolation for coding agents. They solved:

- ✅ MicroVM isolation (stronger than containers)
- ✅ Docker-in-Docker (agents can run containers safely)
- ✅ macOS/Windows support
- ✅ Network routing through HTTP proxy

They did NOT solve:
- ❌ Human-in-the-loop consent
- ❌ Push notification approval
- ❌ The "2FA" moment

**ACP fills this gap.** Docker handles containment. ACP handles consent.

## Usage

```bash
# 1. Start ACP consent proxy
acp proxy --policy policy.yml \
  --telegram-bot-token $BOT_TOKEN \
  --telegram-chat-id $CHAT_ID

# 2. Create Docker Sandbox pointing at ACP
docker sandbox create my-agent --image python:3.12
docker sandbox network proxy my-agent --proxy-url http://host.docker.internal:8444

# 3. Run your agent
docker sandbox exec my-agent -- openclaw start

# Every HTTP request goes through ACP
# "ask" rules trigger Telegram notifications
# Approve/deny from your phone
```

## Policy Language

Simple YAML. Rules match top-to-bottom, first match wins.

```yaml
default: ask  # If no rule matches

rules:
  # ALLOW: no prompt needed
  - match: { host: "*.anthropic.com" }
    action: allow
  - match: { host: "*.openai.com" }
    action: allow
  - match: { host: "pypi.org" }
    action: allow
  - match: { host: "registry.npmjs.org" }
    action: allow

  # ASK: send Telegram notification, wait for approval
  - match: { host: "api.sendgrid.com" }
    action: ask
    timeout: 120  # Auto-deny after 2 minutes
  - match: { host: "*.stripe.com" }
    action: ask
  - match: { host: "api.github.com", method: "POST" }
    action: ask
  - match: { host: "api.github.com", method: "DELETE" }
    action: ask

  # DENY: block immediately
  - match: { host: "*.evil.com" }
    action: deny
```

## Core Components

### 1. ConsentGate — The decision function

```typescript
type ConsentGate = (request: HttpRequest) => Promise<Verdict>

interface Verdict {
  decision: "allow" | "deny"
  reason: string  // "policy:rule3", "human:approved", "timeout:auto-deny"
}
```

### 2. Policy — YAML rule engine

```typescript
interface Policy {
  evaluate(request: HttpRequest): "allow" | "ask" | "deny"
}
```

### 3. Channel — Push notification adapter

```typescript
interface Channel {
  ask(request: HttpRequest, timeoutMs: number): Promise<{ approved: boolean }>
}
```

Primary implementation: TelegramChannel (inline keyboard with Approve/Deny buttons).

### 4. AuditLog — Append-only record

```typescript
interface AuditLog {
  append(request: HttpRequest, verdict: Verdict): void
}
```

Simple JSONL file at `~/.acp/audit.jsonl`.

## File Structure

```
src/
  core/
    types.ts      # HttpRequest, Verdict, PolicyRule
    gate.ts       # createGate() — the decision function
    policy.ts     # loadPolicy() — YAML parsing + rule matching
    channel.ts    # TelegramChannel implementation
    audit.ts      # FileAuditLog — append JSONL

  proxy/
    http-proxy.ts # HTTP forward proxy using ConsentGate

  cli/
    index.ts      # Commander entry point
    proxy.ts      # acp proxy command

tests/
  gate.test.ts
  policy.test.ts
  channel.test.ts
  proxy.test.ts
```

**Estimated size:** ~500-800 lines of TypeScript.

## What We're NOT Building

| Not building | Why |
|---|---|
| Container orchestration | Docker Sandboxes handles this |
| Shell wrappers | microVM isolation is sufficient |
| Docker network setup | Docker handles it |
| MCP proxy | HTTP proxy covers network actions |
| Cryptographic proofs | Phone approval IS the proof |
| Credential vault | Separate concern |

## Telegram Flow

### Sending the consent request

```
POST https://api.telegram.org/bot{TOKEN}/sendMessage
{
  "chat_id": "{CHAT_ID}",
  "text": "🔔 ACP Consent Request\n\nPOST api.sendgrid.com/v3/mail/send\n\nTap to decide:",
  "reply_markup": {
    "inline_keyboard": [[
      { "text": "✅ Approve", "callback_data": "acp:approve:{ID}" },
      { "text": "❌ Deny", "callback_data": "acp:deny:{ID}" }
    ]]
  }
}
```

### Waiting for response

Long-poll `getUpdates`, look for `callback_query` matching the request ID.

### Timeout

If no response within timeout (default 120s), auto-deny and update the message.

## Implementation Plan

### Phase 1: Core protocol
1. `types.ts` — HttpRequest, Verdict, PolicyRule types
2. `policy.ts` — YAML loader + rule matching
3. `channel.ts` — TelegramChannel with inline keyboards
4. `audit.ts` — Append-only JSONL
5. `gate.ts` — createGate() composing the above
6. Tests for each module

### Phase 2: HTTP proxy
1. `http-proxy.ts` — Forward proxy using ConsentGate
2. Handle HTTP and HTTPS CONNECT tunneling
3. Integration tests

### Phase 3: CLI
1. `acp proxy` command with policy/telegram options
2. `acp init` to generate policy template

### Phase 4: Documentation
1. README with Docker Sandboxes integration guide
2. Policy examples for common agents (OpenClaw, Claude Code)

## Verification

1. **Unit tests:** Policy matching, Telegram mocking, audit logging
2. **Integration test:** Start proxy, send request, verify Telegram notification sent
3. **E2E with Docker Sandbox:** Create sandbox, route through ACP, verify consent flow

## Summary

**ACP is a consent-aware HTTP proxy.**

- Plugs into Docker Sandboxes (which handles containment)
- Sends Telegram push notifications for "ask" rules
- Human approves/denies from phone
- Simple YAML policy: allow / ask / deny
- ~500-800 lines of focused code

**The 2FA for agents:** Your phone is the second factor that prevents prompt injection from becoming full compromise.
