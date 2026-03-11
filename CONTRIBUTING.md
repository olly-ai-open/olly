# Contributing

## Development setup

1. Install dependencies:

```bash
npm install
```

2. Configure local environment:

```bash
cp .env.example apps/web/.env.local
```

3. Apply migrations:

```bash
cd apps/web
npx prisma migrate deploy
```

4. Run the app:

```bash
npm run dev
```

## Code quality checks

From `apps/web`:

```bash
npm run lint
npm run typecheck
```

## Pull requests

- Keep PRs focused and small when possible.
- Include a clear description of behavior changes.
- If schema changes are included, add/update Prisma migrations.
- Update docs when configuration or deployment behavior changes.

