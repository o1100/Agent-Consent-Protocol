# Policy Reference

ACP policies are YAML files that control which tool calls are allowed, which need human approval, and which are blocked.

## File Location

Active policy: `~/.acp/policy.yml`

Apply a policy:
```bash
acp policy apply policies/strict.yml
```

View current policy:
```bash
acp policy show
```

## Schema

```yaml
version: "1"                    # Policy format version
default_action: ask             # What to do when no rule matches

rules:
  - match:                      # Criteria for matching tool calls
      tool: "send_*"           # Tool name (glob patterns supported)
      category: communication   # Action category
      server: github            # MCP server name
      args:                     # Argument matching
        path: "~/safe/**"      # Glob patterns in values
    action: allow               # What to do: allow, ask, deny
    level: high                 # Risk level for "ask" actions
    timeout: 300                # Seconds before auto-deny
    rate_limit: "20/minute"    # Rate limiting
    conditions:
      time_of_day:
        after: "09:00"
        before: "17:00"
        timezone: "UTC"
```

## Actions

| Action | Behavior |
|---|---|
| `allow` | Forward to MCP server immediately. No human involved. |
| `ask` | Request human approval. Block until response or timeout. |
| `deny` | Block immediately. Return error to agent. |

## Match Criteria

### `tool` — Tool Name

Matches the MCP tool name. Supports glob patterns:

```yaml
# Exact match
- match: { tool: send_email }

# Prefix match
- match: { tool: "send_*" }

# Suffix match
- match: { tool: "*_file" }

# Match everything
- match: { tool: "*" }
```

### `category` — Action Category

Built-in categories:

| Category | Examples |
|---|---|
| `read` | `read_file`, `web_search`, `get_weather` |
| `write` | `write_file`, `create_event`, `update_record` |
| `communication` | `send_email`, `send_sms`, `message_user` |
| `financial` | `transfer_money`, `charge_card`, `pay_invoice` |
| `system` | `execute_shell`, `deploy_production`, `delete_database` |
| `public` | `send_tweet`, `publish_post`, `release_package` |
| `physical` | `unlock_door`, `toggle_switch` |

ACP auto-classifies tools by name pattern. Override with explicit category in the match.

### `args` — Argument Matching

Match on tool call arguments:

```yaml
# Only allow writing to safe directories
- match:
    tool: write_file
    args:
      path: "~/workspace/**"
  action: allow

# Block emails to specific domains
- match:
    tool: send_email
    args:
      to: "*@competitor.com"
  action: deny
```

## Risk Levels

When `action: ask`, the `level` field controls the urgency:

| Level | Icon | Meaning |
|---|---|---|
| `low` | 🟢 | Low risk, quick approval |
| `medium` | 🟡 | Moderate risk |
| `high` | 🔴 | High risk, review carefully |
| `critical` | ⛔ | Critical, requires careful review |

## Timeout

For `ask` actions, `timeout` specifies seconds before auto-deny:

```yaml
- match: { category: financial }
  action: ask
  level: critical
  timeout: 300  # 5 minutes to decide, then auto-deny
```

Default timeout: 120 seconds (configurable in `~/.acp/config.yml`).

## Rate Limiting

Limit how often a tool can be called:

```yaml
- match: { tool: "*" }
  rate_limit: "20/minute"   # Max 20 calls per minute

- match: { tool: exec }
  rate_limit: "5/minute"    # Max 5 shell commands per minute
```

Supported units: `second`, `minute`, `hour`, `day`.

## Time-of-Day Conditions

Restrict rules to certain hours:

```yaml
# Only auto-approve reads during business hours
- match: { category: read }
  action: allow
  conditions:
    time_of_day:
      after: "09:00"
      before: "17:00"
      timezone: "UTC"
```

Outside the time window, the rule is skipped and the next rule is evaluated.

## Rule Evaluation Order

1. Rules are evaluated **top to bottom**
2. **First matching rule wins**
3. If no rule matches, `default_action` applies

This means more specific rules should go before general ones:

```yaml
rules:
  # Specific: allow reading workspace files
  - match: { tool: read_file, args: { path: "~/workspace/**" } }
    action: allow

  # General: ask for all file reads (catches everything else)
  - match: { tool: "read_*" }
    action: ask

  # Catch-all
  - match: { tool: "*" }
    action: deny
```

## Built-in Policies

| File | Description |
|---|---|
| `policies/default.yml` | Ask for dangerous, allow reads |
| `policies/strict.yml` | Ask for everything except reads |
| `policies/development.yml` | Allow most, ask for dangerous |

## Examples

### Minimal Policy

```yaml
version: "1"
default_action: ask
rules: []
# Everything requires approval
```

### Read-Only Agent

```yaml
version: "1"
default_action: deny
rules:
  - match: { category: read }
    action: allow
```

### Production API Agent

```yaml
version: "1"
default_action: deny

rules:
  - match: { category: read }
    action: allow

  - match: { tool: "api_call", args: { method: "GET" } }
    action: allow

  - match: { tool: "api_call", args: { method: "POST" } }
    action: ask
    level: high

  - match: { tool: "api_call", args: { method: "DELETE" } }
    action: ask
    level: critical
    timeout: 60
```
