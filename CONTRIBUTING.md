# Contributing to ACP

Thanks for your interest in the Agent Consent Protocol! Here's how to get involved.

## Quick Start

```bash
git clone https://github.com/o1100/Agent-Consent-Protocol
cd acp/cli
npm install
npm run build
```

## What We Need

### 🔌 Channel Adapters
- Slack (workspace app with interactive messages)
- Discord (bot with button interactions)
- Signal (via signal-cli)
- Web dashboard (real-time approval UI)

### 🐧 Sandbox Improvements
- LD_PRELOAD-based socket interception (rootless Linux)
- macOS pf firewall integration
- eBPF-based network filtering
- seccomp profiles for additional hardening

### 🧪 Security Review
- Audit the network isolation model
- Review the credential vault encryption
- Penetration testing of the MCP proxy
- Fuzzing the policy parser

### 📖 Documentation
- Video tutorials
- Blog posts and case studies
- Framework-specific integration guides

## Development

### Project Structure

```
cli/src/
├── commands/       # CLI commands (init, run, secret, policy, status)
├── proxy/          # MCP proxy and consent gate
├── sandbox/        # Network isolation and process spawning
├── channels/       # Approval channels (terminal, telegram, webhook)
├── policy/         # YAML policy engine
├── audit/          # Hash-chained audit logger
└── crypto/         # Ed25519 keys and signing
```

### Running Tests

```bash
cd cli
npm test
```

### Code Style

- TypeScript with strict mode
- No external dependencies unless absolutely necessary
- Use Node.js built-in modules where possible
- Every function gets a JSDoc comment

## Pull Requests

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Submit a PR with a clear description

## License

By contributing, you agree that your contributions will be licensed under Apache 2.0.
