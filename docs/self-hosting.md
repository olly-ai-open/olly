# Self-host the Olly server

This guide stands up Olly as a web server that you and other people sign in
to from a browser. It is the always-on alternative to the
[desktop app](desktop.md): briefs generate on schedule whether or not anyone
is looking, several users can share one deployment, and push notifications
work.

It also makes you the operator. You hold every user's OAuth tokens, the
database, the encryption key, and the LLM key, and you pay for the LLM
usage. Read the security section before inviting anyone else.

> Olly is published as-is. There is no hosted version to sign up for, and
> no support for your deployment.

## What you need

- **Node.js 22** and npm 10 for building. Not needed on Vercel.
- **PostgreSQL 14 or newer.** Any provider. Supabase is used as the example
  below.
- **A Google Cloud project with an OAuth client.** Required; sign-in is
  Google only.
- **An LLM API key** from OpenAI, Anthropic, or Google Gemini.
- **A public HTTPS URL.** Vercel gives you one. Anywhere else, put Olly
  behind a reverse proxy that terminates TLS.
- Optional: a Slack app, VAPID keys for push notifications, Langfuse or New
  Relic for tracing.

## 1. Database

Create a Postgres database and note two connection strings:

- `DATABASE_URL`, used at runtime. On Supabase use the **Transaction
  pooler** URL on port 6543 and append `?pgbouncer=true`.
- `DIRECT_URL`, used by migrations. On Supabase use the **Direct** or
  **Session pooler** URL on port 5432.

On a plain Postgres server both are the same URL.

## 2. Google OAuth client

Follow step 2 of the [desktop build guide](desktop-build.md#2-create-your-google-oauth-client),
with two differences:

- Use your public domain in the redirect URIs:

  ```
  https://olly.example.com/api/auth/callback/google
  https://olly.example.com/api/auth/google-connect/callback
  ```

- Decide who may sign in. **Olly has no allowlist.** Any Google account that
  gets past the consent screen can create an account on your server. Your
  options:
  - **Internal** user type, available only with a Google Workspace
    organisation. Only members of your organisation can sign in. This is
    the right choice for a team.
  - **External** in **Testing** status. Only listed test users can sign in,
    up to 100, but refresh tokens expire every seven days and everyone has
    to reconnect Google weekly.
  - **External, published, unverified.** Anyone with a Google account can
    sign in after clicking through a warning, up to 100 users. Only do this
    if you are also going to add an allowlist to the sign-in callback in
    `apps/web/src/lib/auth.ts`.
  - **External, published, verified.** Removes the warning and the cap.
    Gmail and Drive are restricted scopes, so Google requires a security
    assessment by an approved assessor. Budget weeks and real money.

## 3. Optional: Slack app

Follow step 3 of the desktop build guide with the redirect URL
`https://olly.example.com/api/auth/slack-connect/callback`.

## 4. Generate secrets

```bash
# Session signing secret
openssl rand -base64 32

# Field encryption key, from apps/web after npm install.
# Copy the value that starts with k1.aesgcm256.
npx cloak generate

# Cron secret
openssl rand -hex 32

# Push notification keys (optional)
npx web-push generate-vapid-keys
```

Keep the field encryption key somewhere safe. If you lose it, every stored
OAuth token and pasted credential becomes unreadable and every user has to
reconnect everything. Do not rotate it without re-encrypting the data.

## 5. Environment variables

The full template with comments is [`.env.example`](../.env.example). The
variables that matter for a server:

| Variable | Required | Notes |
|---|---|---|
| `NEXTAUTH_URL` | yes | Your public URL, for example `https://olly.example.com` |
| `NEXTAUTH_SECRET` | yes | From `openssl rand -base64 32` |
| `DATABASE_URL`, `DIRECT_URL` | yes | See step 1 |
| `PRISMA_FIELD_ENCRYPTION_KEY` | yes | From `npx cloak generate`. Technically optional, but without it tokens are stored in plaintext. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | yes | From step 2 |
| `LLM_PROVIDER` | yes | `openai`, `anthropic`, or `gemini` |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` | yes | Matching the provider |
| `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GOOGLE_MODEL`, `LLM_TEMPERATURE` | no | Model overrides |
| `CRON_SECRET` | yes in production | Bearer token the cron caller must send |
| `CRON_ENABLED` | no | Set to `false` to pause all scheduled work |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SCOPES` | no | From step 3 |
| `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | no | Push notifications. Subject is a `mailto:` address or `https:` URL identifying you. The public key appears twice because one copy is inlined into the browser bundle at build time. |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | no | LLM tracing |
| `METRICS_AGGREGATES_ENABLED` | no | Powers the admin metrics page. Defaults on. |

Notion, Jira, and Airtable have no server-side configuration. Each user
pastes their own token.

## 6. Deploy on Vercel

The web app is set up for Vercel: cron schedules live in
`apps/web/vercel.json` and the build script runs migrations first.

**You need a paid Vercel plan.** Both cron jobs run every minute, and
Vercel's free Hobby plan only allows cron jobs that run once a day; a
deploy with these schedules fails on Hobby. On Hobby, delete the `crons`
block from `vercel.json` and call the two routes from an external cron
caller instead, as described in step 7.

1. Push the repository to GitHub and import it in Vercel. Vercel starts the
   first deploy from the import screen, so do steps 2 and 3 on that screen
   before you press **Deploy**.
2. Set the project's **Root Directory** to `apps/web`. Vercel detects the
   npm workspace and installs from the repository root.
3. Add every environment variable from step 5 under **Environment
   Variables**. The build needs the database URLs to run migrations, so a
   deploy without them fails. Later changes go under **Settings,
   Environment Variables** for the Production environment.
4. Deploy. The `vercel-build` script runs `prisma migrate deploy` and then
   `next build`, so the schema is applied before the new code goes live.
5. Confirm the two cron jobs appear under **Settings, Cron Jobs**:
   `/api/cron/scheduler` and `/api/cron/worker`, both every minute. Vercel
   sends `Authorization: Bearer <CRON_SECRET>` automatically when the
   `CRON_SECRET` variable is set.

Use one Vercel project per environment. Preview deployments do not run cron
jobs, and pointing two environments at one database makes their schedulers
compete.

## 7. Deploy anywhere else

Olly is a standard Next.js app with `output: "standalone"`, so any host that
runs Node 22 works. You provide three things: a process, a TLS-terminating
proxy, and a cron caller.

**Build:**

```bash
npm ci
npm run build:web
node electron/scripts/copy-standalone-assets.js
node electron/scripts/copy-prisma-resources.js
```

`build:web` is the web app's production build with a larger Node memory
limit; the default limit can run out on small machines.

The two scripts fill gaps in Next's standalone output. The first copies
static assets and the `public/` folder, which Next omits by design; without
them the UI renders without styles. The second copies every Prisma query
engine listed in `schema.prisma`, so a build made on one operating system
runs on another, for example built on a Mac and run on Linux. Both live in
the `electron` folder because the desktop build needs them too, but neither
has an Electron dependency.

**Environment.** The standalone server and the Prisma CLI read their
configuration from the process environment. Set the variables from step 5
there, through your process manager, container, or platform settings, for
both the migrate and run commands below.

**Migrate:**

```bash
cd apps/web && npx prisma migrate deploy
```

**Run:**

```bash
PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production \
  node apps/web/.next/standalone/apps/web/server.js
```

Put it behind nginx, Caddy, or your platform's proxy with TLS, and set
`NEXTAUTH_URL` to the public HTTPS URL. NextAuth is configured with
`trustHost`, so the proxy's forwarded headers are honoured.

**Cron.** Something must call two endpoints once a minute, scheduler first:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://olly.example.com/api/cron/scheduler
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://olly.example.com/api/cron/worker
```

A system crontab entry, a Kubernetes CronJob, or any scheduler that can
send an HTTP request is fine. Each call finishes within about 50 seconds.
The scheduler creates jobs that are due; the worker runs up to 25 of them.

Meeting briefs are queued from a copy of each user's calendar that is
refreshed on the user's chosen interval (hourly by default). A meeting
created or moved less than one interval ahead of its start gets no
automatic brief; the user can click **Generate brief** on the dashboard's
meeting card instead. Shortening the interval multiplies the sync jobs per
user; see the capacity note in [docs/architecture.md](architecture.md).
Running them more often than once a minute gains nothing.

A `Dockerfile` is not provided. The three blocks above are what one would
contain.

## 8. First sign-in and admin

Sign in with Google at your URL. To make yourself an admin, which unlocks
the `/admin` metrics dashboard, set the flag directly in the database:

```sql
UPDATE "User" SET "isAdmin" = true WHERE email = 'you@example.com';
```

There is no UI for this. Every other user is a normal user.

## 9. Upgrading

Pull the new code, redeploy. On Vercel, migrations run during the build.
Elsewhere, run `prisma migrate deploy` before starting the new server.
Migrations are additive and there is no down migration path.

## Security and responsibilities

What you hold as the operator:

- **Every user's Google and Slack OAuth tokens and pasted Notion, Jira, and
  Airtable tokens**, encrypted at rest with your field encryption key.
- **Every brief and everything ingested to write them**: calendar events,
  email excerpts, Slack messages, Notion pages. These are plain rows in the
  database. Field encryption does not cover them.
- **The LLM key.** All users' content goes to your provider account.
- **The database.** Back it up, restrict network access, and use your
  provider's encryption at rest.

What the app does and does not do:

- Sessions are JWTs signed with `NEXTAUTH_SECRET`. Rotating it signs
  everyone out.
- The cron routes are protected only by `CRON_SECRET`. In production the
  app refuses to run them if it is missing.
- There is no rate limiting, no audit log, and no allowlist. See step 2.
- The `/setup` page and its API exist for the desktop app. On a server they
  do nothing useful, and the redirect to them is disabled.

Report vulnerabilities as described in [SECURITY.md](../SECURITY.md).
