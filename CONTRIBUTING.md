# Contributing to On the Fly

Thanks for your interest in On the Fly Core. Issues and pull requests are welcome.

On the Fly Core is the open-source browser extension and editor under [Apache License 2.0](./LICENSE). It is meant to be usable, forkable, inspectable, and improvable by the community. A separate commercial or enterprise offering may exist later with hosted sync, teams, admin controls, SSO, audit logs, managed AI, enterprise deployment, and support—that code is **not** part of this repository.

## How to contribute

1. **Fork** the repository and clone your fork.
2. **Create a branch** from `main` with a short, descriptive name (for example `fix/save-window-classification`).
3. **Make a focused change**—one logical fix or feature per pull request when possible.
4. **Run tests and checks** (see below).
5. **Open a pull request** against `main` with a clear summary, test notes, and any remaining risks.

Maintainers review pull requests before merge. We may ask for changes, tests, or a smaller scope.

## Development setup

```bash
npm install
npm run typecheck
npm run lint
npm test
```

### Build and dev commands

| Command | Purpose |
|---|---|
| `npm run build:public` | Public, local-first build (agent disabled, no localhost host permissions) |
| `npm run verify:public` | Verify public `dist/` has no dev-only agent/backend flags or extra permissions |
| `npm run build` | Local dev build with optional agent hooks |
| `npm run dev:agent` | Run the optional local agent server (developer machines only) |
| `npm run release:public` | Public build + verify + package zip |

## Project constraints (public build)

The **public build** must stay local-first. Do not add:

- Hosted backends or cloud sync
- Accounts or authentication
- Hosted AI in the public extension
- Analytics, tracking, or telemetry
- Demo data or site-specific hardcoded behavior

Manual editing must work without network access after install.

## Save behavior (please preserve)

When changing persistence or shortcuts, keep the explicit-save model:

- Manual edits and agent approvals create **unsaved draft** operations in the current session only.
- **Save all** button persists every dirty draft operation.
- **`S` + drag** (save window) persists only draft operations inside or intersecting the drawn region.
- **`S` alone** enters save-window mode and does **not** save anything by itself.
- Refresh or browser restart replays **saved** operations only.

## Local agent mode (optional, dev-only)

The optional AI agent and `agent-server/` package are for **local development only**. The public build disables agent calls. If you work on agent code:

- Use your own API keys in local `.env` files (never commit them).
- Run `npm run build` (not `build:public`) when testing agent integration.
- Do not wire the public build to a hosted agent or require a backend.

## Pull request expectations

- **Small, focused PRs** are easier to review and merge.
- Include a **clear summary** of what changed and why.
- Confirm **typecheck, lint, and tests** pass (or explain why not).
- Add or update **tests** for behavior changes when practical.
- For **UI changes**, include screenshots or a short GIF in the PR description.
- List **remaining risks** or edge cases you did not cover.

## Do not commit

- `.env` files or secrets
- API keys or tokens
- `node_modules/`
- `dist/`, `build/`, `release/`, or other build outputs
- Release `.zip` artifacts
- Private planning docs, local-only docs, or paths listed in `.gitignore` (for example `docs/`, `.cursor/skills/`, `AGENTS.md` if ignored locally)

If you accidentally commit sensitive data, rotate the secret and force-push only after coordinating with a maintainer.

## Questions

Open a GitHub issue for bugs, ideas, or questions. For security issues, see [SECURITY.md](./SECURITY.md)—do not use public issues for vulnerabilities.
