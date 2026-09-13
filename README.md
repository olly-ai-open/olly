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

Olly reads your calendar, email, Slack, and Notion, and writes the briefs you
would write for yourself if you had the time: what is coming up, what
matters, what you promised, and what happened today.

> [!WARNING]
> **Published as-is.** This repository is provided without support, without
> prebuilt installers, and without a hosted service. It works, it is
> documented, and you are on your own. Issues and pull requests may not get
> a response. **If you need a change, fork.**

## Two ways to run it

| | Desktop app | Self-hosted server |
|---|---|---|
| Runs on | Your Mac or Windows PC | Vercel or any Node host |
| Data lives | On your machine, in a private Postgres | In your Postgres, held by you as operator |
| Users | You | Anyone who can sign in with Google |
| Briefs generate | While the app is open | Always |
| Push notifications | No | Yes |
| Setup effort | Your own Google OAuth client, then one build | Your own Google OAuth client, a database, and a deploy |
| Guide | [Olly Desktop](docs/desktop.md), then [Build the desktop app](docs/desktop-build.md) | [Self-host the server](docs/self-hosting.md) |

Both run the same code. Read [Architecture and extending Olly](docs/architecture.md)
before changing either.

## What it does

- **Morning brief.** Today's meetings, the context behind them, and the
  action items that matter now.
- **Meeting briefs.** Five minutes before each meeting: attendees, recent
  threads, related documents, talking points.
- **End-of-day brief.** What happened, what was decided, what is still open.
- **Action items.** Extracted from briefs, tracked, and rolled forward.
- **People.** A page per person you meet with, built from your interactions.
- **Meeting scheduling.** Describe a meeting, and Olly negotiates a time
  with attendees over email, checks your calendar, and asks you to approve.
- **Generate documents.** One-off documents drafted from the sources you
  pick, and user stories that export to Jira.
- **Integrations.** Google Calendar, Gmail, and Drive; Slack; Notion; Jira;
  Airtable.
- **Bring your own model.** OpenAI, Anthropic, or Gemini.

## Quick start for developers

This runs the web app against a local Postgres. For a desktop build or a
production deployment, use the guides above.

```bash
npm install
cp .env.example apps/web/.env.local   # then fill in DATABASE_URL, Google OAuth, an LLM key
cd apps/web
npx prisma migrate deploy
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Google sign-in needs
the redirect URIs listed in the [desktop build guide](docs/desktop-build.md#2-create-your-google-oauth-client).

Scheduled briefs need the cron routes to be called. In development, with no
`CRON_SECRET` set, you can hit them by hand:

```bash
curl http://localhost:3000/api/cron/scheduler
curl http://localhost:3000/api/cron/worker
```

## Repository layout

- `apps/web` Next.js application: UI, API routes, database schema
- `packages/core` shared logic: agents, tools, jobs, prompts, HTTP clients
- `electron` desktop shell: window, embedded Postgres, job loop
- `docs` the guides linked above

## Tech stack

Next.js 15, React 19, TypeScript, Tailwind CSS 4, Prisma with PostgreSQL,
NextAuth with Google sign-in, the Vercel AI SDK with OpenAI, Anthropic, and
Gemini providers, and Electron for the desktop build.

## Documentation

- [Olly Desktop](docs/desktop.md): what it is, what stays on your machine, what does not work
- [Build the desktop app](docs/desktop-build.md)
- [Self-host the server](docs/self-hosting.md)
- [Architecture and extending Olly](docs/architecture.md)
- [Agent framework](packages/core/src/agents/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

[MIT](LICENSE).
