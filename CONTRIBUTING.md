# Contributing

> [!WARNING]
> Olly is published as-is. Pull requests are welcome, but there is no
> maintainer on duty and no promise that anything will be reviewed or merged.
> **The most reliable way to get a change you need is to fork.**

If you do open a PR, the notes below make it more likely to be useful to the
next person who reads it.

## Development setup

Web app against a local Postgres:

```bash
npm install
cp .env.example apps/web/.env.local
# Fill in DATABASE_URL and DIRECT_URL, Google OAuth client, NEXTAUTH_SECRET,
# PRISMA_FIELD_ENCRYPTION_KEY, and one LLM key.
cd apps/web
npx prisma migrate deploy
npm run dev
```

Desktop shell in development, using the same env file and database. The
shell runs the production build of the web app, so build it first:

```bash
npm run build:web && npm run copy:standalone-assets && npm run copy:prisma-resources
npm run electron
```

In development the desktop shell uses your `DATABASE_URL` instead of the
embedded Postgres and skips migrations, so run them yourself as above.
There is no hot reload in the shell; rebuild and relaunch to see changes.

Building installers is covered in [docs/desktop-build.md](docs/desktop-build.md).

## Before you push

From `apps/web`:

```bash
npm run lint
npm run typecheck
```

CI runs both on every pull request.

## Pull requests

- Keep them focused. One change per PR.
- Say what changed in behaviour, not just what changed in code.
- Schema changes come with a migration, made with
  `npx prisma migrate dev --name <change>` from `apps/web`. Both the schema
  and the migrations folder are committed.
- New environment variables go in `.env.example`, and secrets that must not
  ship in the desktop installer go in the strip list in
  `electron/scripts/build-packaged-env.js`. See the secrets section of
  [docs/architecture.md](docs/architecture.md).
- Update the docs when configuration, deployment, or desktop behaviour
  changes.
- Do not add company names, hosted URLs, or personal identifiers.

Read [docs/architecture.md](docs/architecture.md) for where code goes.
