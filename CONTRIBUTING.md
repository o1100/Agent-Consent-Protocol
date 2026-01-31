# Contributing to ACP

Thank you for your interest in contributing to the Agent Consent Protocol! 🎉

## Ways to Contribute

- **🐛 Report bugs** — Open an issue with a clear description
- **💡 Suggest features** — Use the feature request template
- **📖 Improve docs** — Fix typos, add examples, clarify explanations
- **💻 Write code** — See the areas below
- **🔐 Security review** — Find vulnerabilities responsibly
- **🧪 Write tests** — More coverage is always welcome

## Areas We Need Help With

| Area | What's Needed |
|---|---|
| **Gateway** | WebSocket support, PostgreSQL storage, multi-approver |
| **Channel Adapters** | Slack, Discord, Signal, push notifications, web dashboard |
| **SDKs** | Go SDK, Rust SDK, Java SDK |
| **Framework Integrations** | AutoGen, CrewAI, Vercel AI SDK |
| **Testing** | E2E tests, load testing, fuzzing |
| **Documentation** | Tutorials, video walkthroughs, translations |
| **Security** | Threat modeling, crypto review, pen testing |

## Development Setup

### Gateway (Node.js)

```bash
cd gateway
npm install
npm run dev  # Starts with hot reload
npm test     # Run tests
```

### Python SDK

```bash
cd sdk/python
pip install -e ".[dev]"
pytest
```

### TypeScript SDK

```bash
cd sdk/typescript
npm install
npm run build
```

## Pull Request Process

1. **Fork** the repo and create a feature branch
2. **Write tests** for any new functionality
3. **Follow existing code style** — clean, well-commented
4. **Update documentation** if you're changing behavior
5. **Open a PR** with a clear description of what and why

## Code Style

- **TypeScript**: Use strict mode, proper types (no `any` where avoidable)
- **Python**: Follow PEP 8, use type hints, docstrings on public functions
- **Commits**: Clear, concise commit messages. Conventional commits preferred.

## Security Disclosures

If you find a security vulnerability, please **do not** open a public issue. Instead, email security@acp.dev or open a private advisory on GitHub.

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
