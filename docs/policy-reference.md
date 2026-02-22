# Policy Reference (`v0.3.0`)

ACP policy files are YAML rules that decide agent actions:

- `allow`
- `ask`
- `deny`

## Policy Location

Default active policy (OpenClaw VM mode):

- `/home/<openclaw-user>/.acp/policy.yml`

## Schema

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
      kind: http
      host: "*.example.com"
      method: "GET"
    action: allow
    timeout: 120
```

## Actions

| Action | Behavior |
|---|---|
| `allow` | Execute/forward immediately |
| `ask` | Request human approval via configured channel |
| `deny` | Reject immediately |

## Match Fields

### `name`
Matches shell command name (exact or glob).

### `args`
Matches shell arguments as a glob pattern.

### `kind`
`shell` or `http`.

### `host`
HTTP host match (exact or glob).

### `method`
HTTP method match (`GET`, `POST`, etc).

## Rule Evaluation

1. Top-to-bottom
2. First match wins
3. `default` used when no rule matches

## `wrap` in v0.3.0

`wrap` is **legacy mode only**.

- Used by `acp contain` (Docker wrapper path)
- Not used by `acp start openclaw` VM mode

VM mode primarily evaluates outbound HTTP actions through proxy mediation.

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
