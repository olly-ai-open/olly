# Security Policy

Olly is published as-is, without a support commitment. There is no security
team, no service level agreement, and no guarantee that a report will be acted
on. Please read this page before relying on Olly for anything sensitive.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository
(**Security** tab, then **Report a vulnerability**). Do not open a public
issue for anything that could be exploited before it is fixed.

Include what you found, how to reproduce it, and which runtime it affects:
the desktop app, a self-hosted server, or both.

## What is in scope

- The desktop app under `electron/` and the way it bundles, stores, and
  passes secrets.
- The web app and API routes under `apps/web/`.
- Shared logic, agents, and connectors under `packages/core/`.

Third-party services that Olly talks to (Google, Slack, Notion, Jira,
Airtable, and your LLM provider) are out of scope. Report issues with those
services to their owners.

## Security model in one paragraph

Olly runs in one of two ways. On the desktop, everything stays on your machine
except the content sent to the LLM provider you configure, and each install
generates its own database password, session secret, and field encryption
key. On a self-hosted server, whoever operates the server holds every user's
OAuth tokens, the encryption key, and the LLM key, and is responsible for
securing the database and the host. Field-level encryption covers OAuth
tokens and connector credentials only. Brief contents and ingested calendar,
email, Slack, and Notion text are stored in plaintext in the database.
See `docs/desktop.md` and `docs/self-hosting.md` for the details.

## Supported versions

Only the current `main` branch. There are no maintained release lines.
