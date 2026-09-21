# Architecture and extending Olly

This is the developer guide. It explains how the repository is organised,
how the desktop app and the self-hosted server share one codebase, and
where to put code when you add a feature, a connector, or a vertical.

The one idea to hold on to: **Olly is one product with two runtimes.**
The desktop app and the server run the same Next.js application, the same
agents, and the same job pipeline. Only the shell around them differs.

## Repository layout

```
olly/
├── apps/web/                  Next.js 15 app: UI, API routes, Prisma schema
│   ├── src/app/               App Router pages and /api routes
│   ├── src/components/        React components
│   ├── src/lib/               Thin wrappers over core (auth, prisma, google, slack...)
│   ├── src/middleware.ts      Desktop-only first-run gate
│   ├── prisma/                schema.prisma and migrations/
│   └── vercel.json            Cron schedules for Vercel
├── packages/core/             Shared logic, no framework dependencies
│   └── src/
│       ├── agents/            Agent framework: base classes, tools, personas
│       ├── core/              Domain logic, one *-core.ts per feature
│       ├── prompts/           System prompts
│       ├── *-http.ts          Raw HTTP clients (google-http, slack-http, notion-http)
│       ├── jobs.ts            Job kinds, claiming, retries, dispatch
│       ├── cron-runtime.ts    Scheduler and worker ticks
│       ├── llm.ts             Provider selection (OpenAI, Anthropic, Gemini)
│       └── telemetry/         Langfuse tracing and metrics aggregates
├── electron/                  Desktop shell only
│   ├── main.js                Startup orchestration
│   ├── lib/                   Embedded Postgres, migrations runner, cron loop, secrets, window
│   └── scripts/               Build steps: packaged env, asset copying
├── docs/                      You are here
└── .github/workflows/         CI, and manual Mac and Windows installer builds
```

## The two runtimes

| Concern | Desktop | Self-hosted server |
|---|---|---|
| Web app | Next standalone server spawned by Electron on `localhost:3000` | Same build on Vercel or any Node host |
| Database | Embedded Postgres, private to the app, port `54329` | Any Postgres you provide |
| Migrations | `electron/lib/migrations.js` applies the SQL files itself | `prisma migrate deploy` |
| Session secret, encryption key | Generated per install, stored in `state.json` | Set by the operator in env |
| LLM key | Entered on `/setup`, stored in `secrets.env` | Set by the operator in env |
| Google and Slack app credentials | Baked into the installer from the builder's `.env.local` | Env |
| Scheduled work | `electron/lib/cron.js` calls the two cron routes every minute while the app is open | Vercel Cron or an external caller hits the same routes |
| Users | One | Many, anyone who passes Google sign-in |
| Push notifications | Not available | Available with VAPID keys |
| Tracing | Stripped | Optional |

The web code has exactly one runtime signal: the `OLLY_DESKTOP=1`
environment variable that Electron sets on the server it spawns. Today it
is read in one place, `apps/web/src/middleware.ts`, to enable the first-run
setup redirect. Do not add more `if desktop` branches to business logic. If
a feature genuinely cannot work in one runtime, make it degrade cleanly on
missing configuration, the way web push does when no VAPID keys are set.

## Request flow

```
Browser
  → apps/web/src/app/<page>            server component or client component
  → apps/web/src/app/api/<route>       auth check, input validation, HTTP shape
  → apps/web/src/lib/<wrapper>         resolves prisma, session, settings
  → packages/core/src/core/<feature>-core.ts   the actual logic
  → packages/core/src/agents/personas/<Agent>  when an LLM is involved
  → packages/core/src/agents/tools/<Tool>      what the agent may call
  → packages/core/src/<service>-http.ts        raw API calls
```

Keep the layers thin from the top down. A route should be a few dozen lines.
Anything worth testing lives in core.

## The job pipeline

Every piece of background work is a `Job` row with a `kind`, a `runAt`, and
a status. Two HTTP routes drive it, and both runtimes call them the same
way:

- `GET /api/cron/scheduler` decides what is due and inserts jobs:
  morning and evening briefs from each user's `Schedule` rows, a
  `CALENDAR_SYNC` per connected user at the user's chosen interval (default
  hourly, down to 15 minutes), a `MEETING_BRIEF`
  before each meeting in the next two hours by the user's lead-time
  setting (default five minutes), and a
  `SCHEDULING_POLL` for meeting negotiations awaiting replies.
- `GET /api/cron/worker` claims up to 25 due jobs with a lock, runs each one
  through `packages/core/src/jobs.ts`, and retries failures with backoff up
  to five attempts. When a brief job finishes, the worker fires the
  delivery hooks: a web push if VAPID keys are configured, and an email
  from the user's own Gmail if the email setting is on
  (`packages/core/src/core/briefEmail-core.ts`). Both are best effort and
  never fail the job.

Both routes require `Authorization: Bearer <CRON_SECRET>` in production.

To add background work: add a kind to `JobKind` in `jobs.ts`, add a case to
the dispatcher there, and add whatever enqueues it, either a new rule in
`cron-runtime.ts` or a `prisma.job.create` from a feature. Never add a
`setInterval` inside Electron or a separate cron entry for one feature. If
the work must run while no one has the app open, document that it needs
the server runtime.

## Secrets, in four tiers

Knowing which tier a value belongs to tells you where it is configured and
whether it may ship in the desktop installer.

1. **App-level, shipped.** Google OAuth client, Slack app. Set in env on a
   server; copied into the installer on desktop. Anyone with the installer
   can use them, which is normal for installed OAuth apps.
2. **Per-install, generated.** Postgres password, session secret, field
   encryption key. On desktop `electron/lib/state.js` generates them on
   first launch. On a server the operator sets them. These must never ship
   in an installer.
3. **Per-user, stored.** OAuth tokens in the `Account` table and pasted
   tokens in the `Credential` table, both encrypted with the tier-2 key.
   Read them through `apps/web/src/lib/credentials.ts` or the helpers in
   core such as `getNotionToken`.
4. **LLM key.** `secrets.env` on desktop, env on a server.

When you add an environment variable, add it to `.env.example` and decide
its tier. Anything in tier 2 or 4, and anything that phones home, goes into
`STRIP_KEYS` in `electron/scripts/build-packaged-env.js` and the forbidden
list in `check-packaged-env.js`.

## Adding a feature

1. Put the logic in a new or existing `packages/core/src/core/<feature>-core.ts`.
   It should take a Prisma client and plain inputs and return plain data.
2. If it needs an LLM, add a persona under `agents/personas/` that composes
   existing tools, and a prompt under `prompts/`.
3. Add a schema change with `npx prisma migrate dev --name <change>` from
   `apps/web`. See the migration note below.
4. Add a route under `apps/web/src/app/api/` and a page or component.
5. Add a nav entry in `apps/web/src/components/layout/sidebar.tsx` and
   `mobile-nav.tsx`.
6. If it needs to run on a schedule, follow the job pipeline section.
7. Run `npm run lint` and `npm run typecheck` in `apps/web`.

That is the whole checklist. The feature now works in both runtimes.

## Adding a connector

Connectors have two halves: a way for a user to connect, and a tool that
lets agents read from the service. Notion is the complete worked example.
Jira and Airtable are half-done: they connect and show a status badge, but
no tool reads from them, so they never appear in a brief.

**1. Choose the auth model.** Token paste works everywhere with zero
configuration and is what Notion, Jira, and Airtable use. OAuth requires an
app-level client (tier 1), a redirect URL that differs per runtime
(`http://localhost:3000/...` on desktop, your domain on a server), and a
callback route. Prefer token paste unless the service has no personal
tokens.

**2. HTTP client.** `packages/core/src/<service>-http.ts` with plain
`fetch` functions. See `notion-http.ts`. No SDK unless it earns its place.

**3. Token access.** A helper in core that reads the credential for a user,
like `getNotionToken` in `packages/core/src/notion.ts`, which reads the
`Credential` row for provider `notion` and returns the decrypted token.

**4. Tool.** A class under `agents/tools/` extending `BaseTool`, with a
`name`, a `description` the LLM will read, a zod `parameters` schema with
an `operation` enum, and an `execute` that switches on the operation.
`NotionTool.ts` is the template. Keep operations few and outputs compact;
everything a tool returns goes into the model's context.

**5. Register the tool.** Add it to the `tools` array of each persona that
should use it, and add the service to the `sources` type in that persona's
output schema so the UI can show where the brief came from. Check
`maxToolRoundtrips` on the persona; more tools need more steps.

**6. Connect UI.** A route under `apps/web/src/app/api/auth/<service>-connect/`
that validates the token against the service and calls `saveCredential`,
a matching `-disconnect` route, a card on `apps/web/src/app/integrations/page.tsx`,
and a line in `apps/web/src/app/api/integrations/status/route.ts`.

**7. Env and docs.** For OAuth connectors, add the client variables to
`.env.example`, decide whether they ship in the installer, and document the
redirect URLs in `docs/desktop-build.md` and `docs/self-hosting.md`.

## Building a vertical

A vertical is a persona, a prompt, and a tool selection, plus whatever UI
it needs. Nothing about it is runtime-specific.

- Start with a new persona under `agents/personas/`. Compose the existing
  tools. Write the system prompt in `prompts/` and be explicit about the
  JSON output shape; every existing persona ends its prompt with one.
- Store user-level configuration in `UserSettings`, extended through
  `packages/core/src/core/settings-core.ts`, rather than inventing a new
  settings mechanism.
- Add pages under `apps/web/src/app/`. The dashboard and briefs pages show
  the patterns for server components that call core directly.
- Resist forking. If your vertical needs a different morning brief, pass a
  different prompt or tool list into `MorningBriefAgent` through its
  constructor config instead of copying the class.

## Notes that will save you time

- **Migrations run two ways.** Prisma applies them on a server. On desktop,
  `electron/lib/migrations.js` reads each `migration.sql` and executes it as
  one multi-statement query inside a transaction. Avoid statements that
  cannot run inside a transaction, such as `CREATE INDEX CONCURRENTLY`.
  Keep the schema and the migrations folder in sync; the desktop runner has
  no drift detection.
- **The Prisma client is created twice.** `apps/web/src/lib/prisma.ts` for
  routes and `packages/core/src/prisma-server.ts` for core. Both apply
  field encryption when the key is set. Columns marked `/// @encrypted` in
  the schema are the only encrypted ones.
- **LLM provider and model selection.** Keys come from the environment.
  The provider and model default to `LLM_PROVIDER` and the `*_MODEL`
  variables, falling back to `DEFAULT_MODELS` in `packages/core/src/llm.ts`.
  Each user can override both in Settings; the choice is applied with an
  async-local context (`packages/core/src/llm-context.ts`) that the job
  worker and every LLM-using route establish, so core code keeps calling
  `getLLMProvider()` and `getLLMModel()` unchanged. Adding a provider means
  `llm.ts`, `agents/base/Agent.ts`, the settings labels, and the desktop
  setup screen.
- **Telemetry is optional everywhere.** Langfuse and the metrics aggregates
  no-op without keys. Wrap new agent calls with the same helpers so tracing
  works when it is on.
- **The `sw.js` service worker** exists for web push and is served as an App
  Router route. Do not move it.
- **`electron/` has no build step.** It is plain CommonJS run by Electron's
  Node. Keep it that way; the desktop app must start without a compiler.

## Further reading

- `packages/core/src/agents/README.md` for the agent framework in detail.
- [Olly Desktop](desktop.md) and [Self-host the server](self-hosting.md)
  for the runtime-specific behaviour you are building on top of.
