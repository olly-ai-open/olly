# Olly

AI chief of staff: generates morning, meeting, and end-of-day briefs from a
user's calendar, email, Slack, and Notion, tracks action items, schedules
meetings over email, and drafts documents.

**One product, two runtimes.** A desktop Electron app with an embedded
Postgres, and a self-hosted Next.js server. Same code, different shell.
Read `docs/architecture.md` before changing anything structural.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 4 |
| Backend | Next.js API routes, Node.js 22 |
| Database | PostgreSQL, Prisma 6.18, `prisma-field-encryption` for tokens |
| AI | Vercel AI SDK; OpenAI, Anthropic, or Gemini selected by `LLM_PROVIDER` |
| Auth | NextAuth 5, Google only |
| Desktop | Electron, `embedded-postgres`, electron-builder |
| Hosting | Vercel with cron route handlers, or any Node host plus an external cron caller |
| Observability | Langfuse tracing and metrics aggregates, both optional |

## Layout

```
apps/web/src/app/         pages and /api routes
apps/web/src/lib/         thin wrappers over core
apps/web/prisma/          schema.prisma and migrations
packages/core/src/agents/ base classes, tools, personas
packages/core/src/core/   domain logic, one *-core.ts per feature
packages/core/src/prompts/
packages/core/src/jobs.ts and cron-runtime.ts   job kinds, scheduler, worker
electron/                 desktop shell, plain CommonJS, no build step
docs/                     user and developer guides
```

## Commands

From `apps/web`: `npm run dev`, `npm run build`, `npm run lint`,
`npm run typecheck`, `npx prisma migrate dev --name <change>`.

From the repo root: `npm run dist:mac`, `npm run dist:win` for installers.
`npm run electron` runs the desktop shell against `apps/web/.env.local`; it
needs `npm run build:web && npm run copy:standalone-assets && npm run copy:prisma-resources`
first because the shell serves the production build.

## Rules that matter

- Business logic goes in `packages/core`. Routes stay thin. No `if desktop`
  branches in core; the only runtime signal is `OLLY_DESKTOP=1`, read in
  `apps/web/src/middleware.ts`.
- Background work is a `JobKind` in `packages/core/src/jobs.ts`, enqueued
  by `cron-runtime.ts` or a feature, never a timer of its own.
- New env vars go in `.env.example`. Secrets that must not ship in the
  desktop installer go in `STRIP_KEYS` in `electron/scripts/build-packaged-env.js`
  and the forbidden list in `check-packaged-env.js`.
- Migrations are applied by Prisma on servers and by
  `electron/lib/migrations.js` on desktop, which runs each `migration.sql`
  as one transaction. No `CONCURRENTLY`. Keep schema and migrations in sync.
- No company names, hosted URLs, or personal identifiers in the tree. This
  repo is public and published as-is.

## Key files

| File | Purpose |
|---|---|
| `apps/web/src/lib/auth.ts` | NextAuth configuration |
| `apps/web/src/lib/prisma.ts` | Prisma client with field encryption |
| `apps/web/src/middleware.ts` | Desktop first-run gate |
| `apps/web/src/app/api/cron/` | Scheduler and worker routes |
| `packages/core/src/jobs.ts` | Job execution and retries |
| `packages/core/src/cron-runtime.ts` | What gets scheduled and when |
| `packages/core/src/llm.ts` | Provider and model selection |
| `packages/core/src/agents/base/Agent.ts` | Base agent |
| `packages/core/src/agents/base/Tool.ts` | Tool interface |
| `electron/main.js` | Desktop startup, bootstrap order in the header comment |
| `electron/lib/state.js` | Per-install secrets |
| `apps/web/prisma/schema.prisma` | Database schema |

## Documentation

| Topic | File |
|---|---|
| Desktop overview, security model, limitations | `docs/desktop.md` |
| Building installers | `docs/desktop-build.md` |
| Running a server | `docs/self-hosting.md` |
| Architecture, adding features, connectors, verticals | `docs/architecture.md` |
| Agent framework | `packages/core/src/agents/README.md` |
