# Changelog

## v0.3.0

### Direction

`v0.3.0` narrows scope to make OpenClaw-on-Linux-VM deployments simpler and more reliable.

### Added

- **VM-first startup** — `acp start openclaw` bootstraps OpenClaw on a Linux VM without Docker
- **nftables egress enforcement** — per-user fail-closed outbound rules; only the ACP proxy port is allowed
- **Proxy bootstrap rewrite** — self-contained 4-layer JS bootstrap (`--require`): undici global dispatcher, CONNECT-tunnel agent, https monkey-patch, and fetch wrapper
- **Token auto-detection** — `sk-ant-oat01-` tokens are automatically recognized as setup-tokens in `acp init`
- **Auth-profiles type fix** — setup-tokens are stored as `type: 'setup_token'` (not `api_key`) in OpenClaw auth profiles
- **Memory/swap warning** — `acp start` warns if RAM+swap < 2 GB before installing OpenClaw
- **nftables stderr capture** — `installEgressRules` includes `nft` stderr in thrown errors for easier debugging
- **Webhook URL validation** — `acp init --channel=webhook` rejects empty webhook URLs
- **Host approval cache** — short-TTL cache for repeated HTTP host approvals in the consent gate
- **HTTP CONNECT tunneling tests** — new test suite for allowed/denied/failed CONNECT proxy paths
- **Proxy bootstrap syntax tests** — validates generated bootstrap JS via `vm.Script`, checks all 4 layers

### Changed

- Docker-contained mode (`acp contain`) is still available but is no longer the primary architecture
- Cross-platform expectations reduced; primary path is Linux VM only
- OpenClaw workspace bootstrap is single-command (`acp start openclaw`)

### Security Notes

- VM mode prioritizes network mediation reliability
- Default config under user home means policy/config tampering is possible unless operators harden file ownership
- Recommended: move policy/config/state to root-owned paths and run ACP under systemd
