# Security Policy

## Project Status

ACP is an **experimental prototype (v0.3)** — a working implementation of container-based agent consent enforcement. It has not undergone formal security review. We take security seriously and want to know about issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.3.x   | Current   |
| 0.2.x   | No        |

## Known Limitations

1. **macOS/Windows isolation is weaker than Linux.** On Linux, Docker `--internal` networks provide kernel-enforced isolation (no internet gateway). On macOS/Windows, isolation relies on proxy environment variables (`HTTP_PROXY`/`HTTPS_PROXY`) and DNS blocking. A deliberately adversarial agent could bypass proxy env vars by making direct TCP connections to raw IPs. Docker Desktop's microVM-based sandboxes would fix this, but they don't yet support custom agents.

2. **Shell wrappers only cover listed commands.** The `wrap` list in your policy determines which commands get intercepted at Layer 1. Unlisted commands execute without consent but still hit Layer 2 (HTTP proxy) if they make network requests.

3. **Programmatic file deletion is a known gap.** Shell wrappers catch `rm`, `rmdir`, etc. But a long-running Python process calling `os.remove()` bypasses the wrapper. The read-only container filesystem mitigates this for system files, but the mounted workspace volume is writable.

4. **No replay protection.** Approval tokens are time-limited but not persisted across restarts.

## Reporting a Vulnerability

**Email:** hello@agent2fa.dev

Please include:
- Description of the issue
- Steps to reproduce
- Impact assessment

We aim to acknowledge reports within 48 hours.

**Please do not open public GitHub issues for security vulnerabilities.**

## Scope

In scope:
- Bypasses of the consent gate
- Container escape vectors
- Policy engine bypasses
- Network isolation bypasses
- Anything that lets an agent act without human knowledge

Out of scope (documented limitations):
- macOS/Windows proxy bypass (documented)
- Programmatic file deletion gap (documented)
