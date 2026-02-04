# Contributing to ACP

Thanks for your interest in the Agent Consent Protocol!

## Quick Start

```bash
git clone https://github.com/o1100/Agent-Consent-Protocol
cd Agent-Consent-Protocol/cli
npm install
npm run build
npm test    # 47 tests
```

## What We Need

### Channel Adapters
- Slack (workspace app with interactive messages)
- Discord (bot with button interactions)
- Signal (via signal-cli)
- Web dashboard (real-time approval UI)

### Container Improvements
- gVisor runtime support for syscall-level interception
- Firecracker microVM integration for strongest isolation
- Custom Docker images for common agent runtimes
- FUSE overlay for workspace file deletion interception

### Security Review
- Container escape analysis
- HTTP proxy bypass testing
- Shell wrapper circumvention testing
- Policy parser fuzzing

### Documentation
- Video tutorials
- Blog posts and case studies
- Framework-specific integration guides

## Project Structure

```
cli/src/
  core/              # The protocol (~300 lines)
    types.ts         # Action, Verdict, PolicyRule
    gate.ts          # createGate() — the consent gate
    policy.ts        # YAML policy engine + glob matching
    channel.ts       # TelegramChannel, WebhookChannel
    audit.ts         # FileAuditLog — append-only JSONL

  container/         # Container enforcement (~600 lines)
    docker.ts        # Docker network + container orchestration
    http-proxy.ts    # HTTP forward proxy (Layer 2)
    shell-wrappers.ts # Generate wrapper scripts (Layer 1)
    consent-server.ts # HTTP server for wrapper callbacks

  cli/               # CLI commands
    index.ts         # Entry point
    init.ts          # acp init
    contain.ts       # acp contain -- <command>

  tests/             # 47 tests
    gate.test.ts
    policy.test.ts
    channel.test.ts
    container.test.ts
    http-proxy.test.ts
    shell-wrappers.test.ts
```

## Running Tests

```bash
cd cli
npm test
```

## Code Style

- TypeScript with strict mode
- Minimal external dependencies
- Use Node.js built-in modules where possible

## Pull Requests

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Submit a PR with a clear description

## License

By contributing, you agree that your contributions will be licensed under Apache 2.0.
