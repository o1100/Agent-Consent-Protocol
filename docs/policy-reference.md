# ACP Policy Reference

## Overview

Policies are declarative JSON files that control how the ACP Gateway handles each action. No code needed — just configure rules.

## Policy Structure

```json
{
  "type": "policy",
  "version": "0.1.0",
  "id": "policy_id",
  "name": "Human-readable name",
  "description": "What this policy does",
  "rules": [...],
  "defaults": {...}
}
```

## Rules

Rules are evaluated in **priority order** (highest first). First match wins.

### Rule Schema

```json
{
  "id": "rule_unique_id",
  "name": "Human-readable name",
  "match": {
    "risk_level": ["low", "medium", "high", "critical"],
    "category": ["communication", "financial", "data", "system", "public", "identity", "physical"],
    "agent_id": ["agent_1", "agent_2"]
  },
  "action_pattern": "send_*",
  "decision": "always_ask",
  "priority": 100,
  "conditions": {...},
  "constraints": {...},
  "message": "Custom message to show when this rule triggers"
}
```

### Match Criteria

| Field | Type | Description |
|---|---|---|
| `risk_level` | string[] | Match actions with these risk levels |
| `category` | string[] | Match actions in these categories |
| `agent_id` | string[] | Match specific agents |
| `action_pattern` | string | Glob pattern for tool names (e.g., `send_*`, `delete_*`) |

If no match criteria are specified, the rule matches all actions.

### Decision Types

| Decision | Behavior |
|---|---|
| `auto_approve` | Execute immediately without asking |
| `ask_once_per_session` | Ask first time, remember for the session |
| `ask_once_per_pattern` | Ask first time for a tool pattern, remember |
| `always_ask` | Ask every single time |
| `never_allow` | Block immediately, never execute |

### Conditions

```json
{
  "conditions": {
    "time_of_day": {
      "after": "09:00",
      "before": "17:00",
      "timezone": "America/New_York"
    }
  }
}
```

Rules with conditions only apply when conditions are met. If conditions aren't met, the rule is skipped and evaluation continues.

### Constraints

```json
{
  "constraints": {
    "max_amount": 10000,
    "currency": "USD",
    "daily_limit": 50000,
    "require_reason": true,
    "trust_duration_seconds": 3600,
    "rate_limit": {
      "max_actions": 10,
      "window_seconds": 3600
    },
    "blocked_patterns": ["rm -rf", "DROP TABLE"],
    "allowed_patterns": ["ls", "cat", "grep"]
  }
}
```

| Constraint | Description |
|---|---|
| `rate_limit` | Max actions per time window; exceeding triggers `always_ask` |
| `blocked_patterns` | Substrings in parameters that cause `never_allow` |
| `allowed_patterns` | Whitelist patterns (informational) |
| `trust_duration_seconds` | How long a session approval lasts |
| `max_amount` | Maximum amount for financial actions |
| `daily_limit` | Maximum total amount per day |

## Defaults

```json
{
  "defaults": {
    "unmatched_action": "always_ask",
    "timeout_seconds": 900,
    "reminder_seconds": 300,
    "max_pending_requests": 20,
    "notification_channels": ["telegram"]
  }
}
```

| Field | Description |
|---|---|
| `unmatched_action` | Decision for actions that don't match any rule |
| `timeout_seconds` | Default timeout for consent requests |
| `reminder_seconds` | Send a reminder after this many seconds |
| `max_pending_requests` | Maximum concurrent pending requests |
| `notification_channels` | Channels to deliver requests to |

## Action Categories

| Category | Examples |
|---|---|
| `communication` | Email, Slack, SMS |
| `financial` | Payments, transfers, orders |
| `data` | File I/O, database queries |
| `system` | Shell commands, deployments, config |
| `public` | Social media, blog posts |
| `identity` | Auth changes, profile updates |
| `physical` | IoT, locks, drones |

## Risk Levels

| Level | Description | Default Behavior |
|---|---|---|
| `low` | Easily reversible, limited impact | Auto-approve |
| `medium` | Somewhat reversible, moderate impact | Ask once |
| `high` | Difficult to reverse, significant impact | Always ask |
| `critical` | Irreversible, severe impact | Always ask |

## Example Policies

See the [examples/policies/](../examples/policies/) directory for complete policy files:
- `default.json` — Balanced defaults for production
- `strict.json` — High security, blocks dangerous patterns
- `development.json` — Permissive for development/testing

## Hot Reloading

When using a file-based policy, the Gateway checks for file changes on each request. Update the JSON file and changes take effect immediately — no restart needed.

## API

```bash
# Get current policy
curl http://localhost:3000/api/v1/policies

# Update policy
curl -X PUT http://localhost:3000/api/v1/policies \
  -H "Content-Type: application/json" \
  -d @policy.json
```
