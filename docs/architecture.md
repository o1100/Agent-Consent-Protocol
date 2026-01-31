# ACP Architecture

## Overview

The Agent Consent Protocol is built around a **separation of trust boundaries**. The agent and the consent system are deliberately isolated so that a compromised agent cannot bypass, forge, or manipulate human approvals.

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  AGENT RUNTIME   │     │  ACP GATEWAY     │     │  HUMAN DEVICE    │
│                  │     │  (separate       │     │  (phone, laptop) │
│  LLM + Tools     │────▶│   process)       │────▶│                  │
│  ACP Middleware   │     │  Policy Engine   │     │  Telegram / Web  │
│                  │◀────│  Audit Trail     │◀────│  Push / Email    │
│                  │     │  Crypto Signing  │     │                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
      Agent                   Gateway                   Human
   can't bypass            holds keys              out-of-band
   the middleware          signs proofs            approves/denies
```

## Components

### 1. ACP Middleware (SDK)

Lives inside the agent's process. Intercepts tool calls and:
- Classifies actions by category and risk level
- Evaluates local policy rules
- Sends consent requests to the Gateway
- Polls for responses
- Verifies cryptographic proofs
- Blocks or allows tool execution

The middleware is a thin client — it has no signing keys and cannot forge approvals.

### 2. ACP Gateway

A standalone HTTP server that:
- Receives consent requests from agents
- Evaluates the full policy engine
- Routes requests to approval channels
- Collects human responses
- Signs consent proofs with Ed25519 keys
- Maintains the hash-chained audit trail
- Stores consent state in SQLite

The Gateway is the security boundary. It must run in a separate process (ideally on a separate machine in production).

### 3. Approval Channels

Pluggable adapters that deliver consent requests to humans:
- **Telegram**: Inline button messages (✅ Approve / ❌ Deny)
- **Webhook**: Generic HTTP POST for custom integrations
- **CLI**: Terminal-based for development
- **Web Dashboard**: (planned) Rich web UI
- **Push Notification**: (planned) iOS/Android

### 4. Audit Trail

Append-only JSONL file with SHA-256 hash chaining:
- Every event links to the previous event's hash
- Tampering with any event breaks the chain
- Queryable by request ID, agent, time, category, etc.

## Request Flow

```
1. Agent calls tool("send_email", {to: "ceo@co.com"})
2. SDK middleware intercepts the call
3. SDK classifies: category=communication, risk=high
4. SDK sends POST /api/v1/consent/request to Gateway
5. Gateway evaluates policy → "always_ask"
6. Gateway routes to Telegram adapter
7. Human receives Telegram message with [Approve] [Deny]
8. Human taps [Approve]
9. Gateway signs the approval with Ed25519
10. SDK polls GET /api/v1/consent/:id → gets signed proof
11. SDK verifies the signature
12. Tool executes: email sends
13. Audit trail records the full lifecycle
```

## Data Flow Diagram

```
                    ┌─────────────────────────┐
                    │     Policy JSON File     │
                    │   (hot-reloadable)       │
                    └────────────┬────────────┘
                                 │
┌─────────────┐    ┌─────────────▼─────────────┐    ┌──────────────┐
│  Agent SDK  │───▶│      ACP GATEWAY          │───▶│  Telegram    │
│  (HTTP)     │    │                            │    │  Bot API     │
│             │◀───│  REST API ─▶ Policy Engine │◀───│              │
└─────────────┘    │           ─▶ Consent Store │    └──────────────┘
                   │           ─▶ Crypto Module │
                   │           ─▶ Audit Trail   │
                   └────────────────────────────┘
                        │              │
                   ┌────▼───┐    ┌─────▼────┐
                   │ SQLite │    │  JSONL   │
                   │  (DB)  │    │ (Audit)  │
                   └────────┘    └──────────┘
```

## Deployment Models

### Development
- Gateway runs locally (same machine as agent)
- CLI adapter for terminal-based approval
- SQLite in-memory database
- No authentication required

### Production (Single User)
- Gateway runs as a Docker container
- Telegram adapter for mobile approval
- SQLite file database
- API key authentication

### Production (Team)
- Gateway behind a reverse proxy (nginx/Caddy)
- Multiple approval channels
- PostgreSQL database (planned)
- mTLS between agent and gateway
- Multiple approver support
