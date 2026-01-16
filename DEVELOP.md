## Environment variables
All environment variables in AWS SSM. To retrieve the env variables for local development, run the following script:

      $ ./scripts/sync-env.sh

This downloads all the needed env variables to local `.env.local` files. Do not commit these files to git.

*NOTE*: You need to make a manual change to `NEXTAUTH_URL` in `apps/web/.env.local`. Set the value to `http://localhost:3000`.

## Node
The project depends on `node v22`.

## Build web app

      $ cd apps/web
      $ npm i

## Run web app

      $ npm run dev

Open http://localhost:3000.
