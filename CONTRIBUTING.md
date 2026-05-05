# Contributing

Thank you for improving LLM Pulse. Keep changes focused, verified, and aligned with the current deployment model.

## Project Shape

This repository is an npm workspaces monorepo:

- `apps/server` contains the Express BFF that reads aggregated data from `new-api` PostgreSQL.
- `apps/frontend` contains the Vite and React dashboard served under `/status/`.
- `packages/shared` contains shared TypeScript response types.

The production deployment currently keeps the service running from `/root/repos/llm-pulse` as `root`. Do not change that runtime constraint unless a separate task explicitly asks for it. Security work in this repository should use compensating controls, such as localhost binding, Nginx restrictions, systemd sandboxing, secret hygiene, and CI checks.

## Setup

Use the Node version from `.nvmrc`:

```bash
nvm use
npm install
```

Create a local environment file from the example if needed:

```bash
cp .env.example .env
```

Use only placeholder or local development values in documentation and examples. Never commit real `DATABASE_URL`, `.env`, `/etc/llm-pulse.env`, raw user logs, or production host details.

## Development Commands

Run commands from the repository root:

```bash
npm run dev
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Use `npm run format` only when you intend to update formatting.

## Pull Request Checklist

Before opening a pull request:

- Keep the change scoped to one topic.
- Update shared types and tests when changing API response shape.
- Update `README.md`, `deploy/README.md`, or architecture docs when behavior changes.
- Verify that public `/status/api/*` responses remain sanitized.
- Confirm that no real secrets, internal hostnames, raw logs, or database dumps were added.
- Run `npm run format:check`, `npm run lint`, `npm run typecheck`, relevant tests, and `npm run build` when applicable.

## Security Expectations

The dashboard is intentionally public for aggregate availability data. Treat everything behind the aggregation boundary as sensitive:

- Do not expose raw upstream logs or request bodies.
- Do not log connection strings or database passwords.
- Redact PostgreSQL connection failures before returning them to clients.
- Keep production credentials in runtime environment files or a secret manager, not in git.
- Prefer read-only database credentials with the smallest required table access.
