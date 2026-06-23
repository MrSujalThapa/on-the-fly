# Security Policy

If you believe you have found a security vulnerability in On the Fly Core, **please do not open a public GitHub issue**.

Email the maintainer instead:

**sujalthapa242@gmail.com**

We are a small early-stage open-source project. We will acknowledge your report as soon as practical and work with you on a fix when possible.

## What to include

Help us reproduce and prioritize the issue:

1. **Summary** — What is vulnerable and where (extension component, script, build, etc.)?
2. **Steps to reproduce** — Minimal steps from a clean install or build.
3. **Affected version** — Release tag, commit SHA, or `main` branch date.
4. **Environment** — Browser (Chrome version), OS, and whether you used a public or local-dev build.
5. **Potential impact** — Data exposure, privilege escalation, XSS, unexpected network calls, etc.
6. **Suggested fix** — Optional, but appreciated.

## Supported versions

Security fixes are intended for:

- The latest **`main`** branch
- The latest **public release tag** (when published)

Older tags may not receive backports unless the issue is severe and practical to fix.

## Scope notes

- The **public build** is local-first: it should not send webpage content to a hosted backend, analytics service, or cloud account system.
- **API keys** and local agent **`.env`** files must never be committed to the repository. If you find secrets in history or releases, report them immediately.
- The optional **local agent server** runs on your machine in developer setups only; it is not part of the published public extension package.
- Reports about missing enterprise features (SSO, audit logs, hosted sync, etc.) are out of scope for this open-source core repository.

## Disclosure

We prefer coordinated disclosure. Please give us reasonable time to investigate and patch before public discussion. We will credit reporters in release notes when they agree.

Thank you for helping keep On the Fly safe for users and contributors.
