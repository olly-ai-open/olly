
## Deploying web app

Pushing `main` on github will automatically trigger the app deployment on Vercel.

### Environment Variables
The webapp is setup to read the environment variables from [Vercel's environment variables](https://vercel.com/<org>/<project>/settings/environment-variables). These environment variables are only read once per deployment.

### Vercel Cron
Cron scheduling and job processing now run through Vercel route handlers:

- `/api/cron/scheduler` (every minute)
- `/api/cron/worker` (every minute)

Required cron env vars per Vercel project/environment:

- `CRON_SECRET` (required in production)
- `CRON_ENABLED` (`true` by default, set `false` for emergency stop)

For multi-environment scheduling, use a separate Vercel project per environment so each can run its own production cron schedule with isolated DB/secrets.



   
