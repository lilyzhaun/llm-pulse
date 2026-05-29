# Security Policy

LLM Pulse exposes a public, read-only status dashboard for aggregated model availability. The public API is limited to sanitized operational data under `/status/api/*` and must never include raw upstream logs, database connection strings, credentials, request bodies, or personally identifiable information.

## Supported Versions

This repository is currently maintained from the `main` branch. Security fixes should target the active branch unless a maintainer documents a separate release branch.

## Reporting a Vulnerability

Please report security issues privately to the repository maintainers. If GitHub private vulnerability reporting is enabled for this repository, use that channel. Otherwise, contact the maintainer through the private operational channel already used for this deployment.

Do not open a public issue that includes secrets, production hostnames, raw logs, database output, or exploit details. A good report includes:

- The affected component, such as `apps/server`, `apps/frontend`, CI, deployment docs, or Nginx/systemd templates.
- A short impact summary.
- Safe reproduction steps that use placeholders instead of real credentials or internal hosts.
- Any relevant sanitized logs or screenshots.

## Secret Handling

- Never commit `.env`, `/etc/llm-pulse.env`, production connection strings, API keys, database passwords, raw user logs, or upstream request bodies.
- Use placeholder values in documentation, for example `postgres.example.internal` and `REDACTED_PASSWORD`.
- Keep runtime credentials outside the repository and restrict environment file permissions to the service runtime user.
- Rotate any credential immediately if it may have been exposed in git history, logs, screenshots, CI output, or chat transcripts.

## Public API Boundary

The following endpoints are intentionally public, read-only, and designed for sanitized status data:

- `GET /status/api/pulse`
- `GET /status/api/health`
- `GET /status/api/metrics`, with deployment-level access restrictions where configured

These endpoints must not return raw PostgreSQL errors, connection strings, database host details, upstream request payloads, user identifiers, or credential material. If a future change needs sensitive data, review the access control design before merging it.

## Dependency and Secret Scanning

CI runs dependency checks and secret scanning. Local contributors should also run these checks when touching dependency or deployment files:

```bash
npm audit --audit-level=high
npm audit signatures
```

If a scan flags a real secret, revoke or rotate the secret first, then remove the exposure from the repository and any logs.
