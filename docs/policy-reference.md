# Policy Reference (`v0.3.0`)

ACP policy files are YAML rules that decide agent actions:

- `allow`
- `ask`
- `deny`

## Policy Location

Default active policy (OpenClaw VM mode):

- `/home/<openclaw-user>/.acp/policy.yml`

## Schema (VM mode)

```yaml
default: ask

rules:
  - match:
      kind: http
      host: "*.example.com"
      method: "GET"
    action: allow
    timeout: 120
```

In VM mode (`acp start openclaw`), policy evaluates outbound HTTP requests hitting ACP's proxy. The `name` and `args` match fields are not used — all enforcement is at the network layer via host/method matching.

### Legacy schema (Docker mode only)

```yaml
default: ask

wrap:
  - gh
  - git
  - curl

rules:
  - match:
      name: "gh"
      args: "pr list*"
    action: allow
```

The `wrap` list and `name`/`args` match fields are only used by `acp contain` (Docker mode), where PATH-based shell wrappers intercept commands before execution.

## Actions

| Action | Behavior |
|---|---|
| `allow` | Execute/forward immediately |
| `ask` | Request human approval via configured channel |
| `deny` | Reject immediately |

## Match Fields

### VM mode (`acp start openclaw`)

| Field | Description |
|---|---|
| `kind` | `http` (only relevant kind in VM mode) |
| `host` | HTTP host match (exact or glob) |
| `method` | HTTP method match (`GET`, `POST`, etc) |

### Legacy Docker mode (`acp contain`)

| Field | Description |
|---|---|
| `name` | Shell command name (exact or glob) |
| `args` | Shell arguments as a glob pattern |
| `kind` | `shell` or `http` |
| `host` | HTTP host match (exact or glob) |
| `method` | HTTP method match (`GET`, `POST`, etc) |

## Rule Evaluation

1. Top-to-bottom
2. First match wins
3. `default` used when no rule matches

## `wrap` in v0.3.0

`wrap` is **Docker mode only** (`acp contain`). It is ignored by `acp start openclaw`.

In VM mode, there are no shell wrappers. All enforcement is at the network layer: nftables blocks direct egress, and HTTP traffic is routed through ACP's consent proxy where `rules` are evaluated by host/method.

## Built-in Templates

| File | Purpose |
|---|---|
| `default.yml` | balanced defaults |
| `strict.yml` | ask/deny-heavy |
| `openclaw.yml` | OpenClaw-centric host defaults |

## Example: VM-focused policy

```yaml
default: ask
wrap: []
rules:
  - match: { kind: http, host: "api.telegram.org" }
    action: allow
  - match: { kind: http, host: "*.anthropic.com" }
    action: allow
  - match: { kind: http, host: "api.search.brave.com" }
    action: allow
```
