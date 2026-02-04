# Policy Reference

ACP policies are YAML files that control which agent actions are allowed, which need human approval, and which are blocked.

## File Location

Active policy: `~/.acp/policy.yml`

## Format

```yaml
default: ask              # What to do when no rule matches: allow, ask, deny

wrap:                     # Commands to intercept at Layer 1 (shell wrappers)
  - gh
  - git
  - curl
  - rm

rules:
  - match:                # Criteria for matching actions
      name: "gh"          # Command name (exact or glob)
      args: "pr list*"    # Command arguments (glob)
      kind: http          # Action kind: shell or http
      host: "*.example.com"  # HTTP host (glob, for kind: http)
      method: "GET"       # HTTP method (for kind: http)
    action: allow         # What to do: allow, ask, deny
    timeout: 120          # Seconds before auto-deny (for ask actions)
```

## Actions

| Action | Behavior |
|---|---|
| `allow` | Execute immediately. No human involved. |
| `ask` | Request human approval via configured channel. Block until response or timeout. |
| `deny` | Block immediately. Agent gets an error. |

## Match Criteria

### `name` — Command Name
Matches the shell command name. Supports glob patterns:
```yaml
- match: { name: "cat" }         # Exact match
- match: { name: "gh" }          # Exact match
```

### `args` — Command Arguments
Matches command arguments. Supports glob patterns:
```yaml
- match: { name: "gh", args: "pr list*" }    # gh pr list ...
- match: { name: "rm", args: "-rf /*" }       # rm -rf /...
```

### `kind` — Action Kind
Filters by action type. Prevents shell rules from matching HTTP actions and vice versa:
```yaml
- match: { kind: http, host: "*.example.com" }   # HTTP only
- match: { kind: shell }                          # Shell commands only
```

### `host` — HTTP Host
Matches the destination host for HTTP/HTTPS requests. Supports glob patterns:
```yaml
- match: { kind: http, host: "*.anthropic.com" }   # Any anthropic subdomain
- match: { kind: http, host: "api.github.com" }    # Exact host
```

### `method` — HTTP Method
Matches the HTTP method:
```yaml
- match: { kind: http, host: "api.github.com", method: "GET" }    # GET only
- match: { kind: http, host: "api.github.com", method: "POST" }   # POST only
```

## The `wrap` List

The `wrap` section lists which executables get shell wrapper scripts inside the container. Only wrapped commands go through Layer 1 (shell interception). Everything else executes directly but still hits Layer 2 (HTTP proxy) if it makes network requests.

```yaml
wrap:
  - gh        # GitHub CLI
  - git       # Git
  - curl      # cURL
  - wget      # wget
  - rm        # Remove files
  - psql      # PostgreSQL client
  - python    # Python interpreter
  - node      # Node.js
```

## Rule Evaluation

1. Rules are evaluated **top to bottom**
2. **First matching rule wins**
3. If no rule matches, `default` applies
4. More specific rules should go before general ones

## Built-in Policy Templates

| File | Description |
|---|---|
| `default.yml` | Safe reads allowed, common HTTP hosts allowed, dangerous commands ask |
| `strict.yml` | Only `cat`/`ls` auto-allowed, everything else asks |
| `openclaw.yml` | Telegram API + LLM providers auto-allowed, payment domains ask |

## Examples

### Minimal Policy
```yaml
default: ask
wrap: []
rules: []
# Everything requires approval. No shell wrappers.
```

### Read-Only Agent
```yaml
default: deny
wrap:
  - rm
rules:
  - match: { name: "cat" }
    action: allow
  - match: { name: "ls" }
    action: allow
  - match: { name: "grep" }
    action: allow
  - match: { kind: http, host: "*.anthropic.com" }
    action: allow
```

### Production API Agent
```yaml
default: deny
wrap:
  - curl
  - wget
  - rm
  - psql
rules:
  - match: { name: "cat" }
    action: allow
  - match: { name: "ls" }
    action: allow
  - match: { kind: http, host: "api.myservice.com", method: "GET" }
    action: allow
  - match: { kind: http, host: "api.myservice.com", method: "POST" }
    action: ask
    timeout: 60
  - match: { name: "rm", args: "-rf /*" }
    action: deny
  - match: { name: "psql" }
    action: ask
    timeout: 120
```
