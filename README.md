# Olly

<p align="center">
  <img src="apps/web/public/olly-mascot.png" alt="Olly Mascot" width="140" />
</p>

<p align="center">
  <b>Your AI Chief of Staff</b><br/>
  Meeting briefs. Morning briefs. End-of-day wrap-ups. Action items. Fewer dropped balls.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/Prisma-6.18-2D3748?logo=prisma" alt="Prisma 6.18" />
  <img src="https://img.shields.io/badge/Node-22+-339933?logo=nodedotjs&logoColor=white" alt="Node 22+" />
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT License" />
</p>

## What It Does

Olly pulls context from your workspace and helps you stay ahead of your day:

- Pre-meeting briefs with context and talking points
- Morning brief for what matters now
- End-of-day summary and action-item rollup
- Generates documents (recurring or one-off) from connected data sources

## Quick Links

- [Quickstart](#quickstart-local)
- [Deployment](#deployment-vercel-recommended)
- [Environment Variables](#environment-variables)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## Monorepo Layout

- `apps/web`: Next.js application (main product)
- `packages/core`: shared business logic (LLM, jobs, integrations)

## Tech Stack

- Next.js 15 (App Router)
- React 19
- Prisma + PostgreSQL
- NextAuth (Google sign-in)
- OpenAI / Anthropic / Gemini (runtime-selectable)
- Optional integrations: Google Workspace, Slack, Notion, Langfuse

## Prerequisites

- Node.js 22+
- npm 10+
- PostgreSQL
- Google OAuth app credentials (required for login)

## Quickstart (local)

1. Install dependencies.

```bash
npm install
```

2. Create local env file from template.

```bash
cp .env.example apps/web/.env.local
```

3. Run migrations.

```bash
cd apps/web
npx prisma migrate deploy
```

4. Start the app.

```bash
npm run dev
```

Alternative from repo root:

```bash
npm run dev --workspace=apps/web
```

5. Open [http://localhost:3000](http://localhost:3000).

## OAuth Callback URLs

Add these to your OAuth provider config (adjust host for non-local env):

- Google sign-in (NextAuth): `http://localhost:3000/api/auth/callback/google`
- Google advanced connect: `http://localhost:3000/api/auth/google-connect/callback`
- Slack connect: `http://localhost:3000/api/auth/slack-connect/callback`
- Notion connect: `http://localhost:3000/api/auth/notion-connect/callback`

## Deployment (Vercel recommended)

Olly is configured to deploy `apps/web` on Vercel.

1. Create/import the project in Vercel.
2. Add env vars from [`.env.example`](.env.example).
3. Set `NEXTAUTH_URL` to your production domain.
4. Set `CRON_SECRET` in production.
5. Deploy.

Cron routes are defined in [`apps/web/vercel.json`](apps/web/vercel.json):

- `/api/cron/scheduler` every minute
- `/api/cron/worker` every minute

## Why Olly

| Capability | Why it helps |
| --- | --- |
| Meeting prep | Walk in with context, not guesswork. |
| Morning brief | Start with priorities, not inbox chaos. |
| End-of-day summary | Capture outcomes and close loops. |
| Action items | Keep commitments visible and assignable. |

## Environment Variables

See [`.env.example`](.env.example) for the full list and defaults.

## Open Source

- [LICENSE](LICENSE)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md)
