# Olly Desktop

Olly Desktop is the same Olly application packaged as a Mac or Windows app.
It bundles the web app, a private PostgreSQL database, and a background job
loop into one installer, so everything runs on your own machine.

This page explains what you get, what stays on your machine, and what does
not work compared with running Olly as a server. To build it, see
[Build the desktop app](desktop-build.md).

> Olly is published as-is. There are no prebuilt installers, no updates, and
> no support. You build it from source with your own Google OAuth client.

## What it is

- One app that starts a local web server on `http://localhost:3000` and opens
  it in a window.
- A PostgreSQL instance private to the app, on port `54329`, with its data
  under your user profile. No system Postgres is installed or touched.
- A job loop that runs the scheduler and worker once a minute while the app
  is open, so morning, evening, and meeting briefs generate on schedule.
- A first-run setup screen where you paste your own OpenAI, Anthropic, or
  Gemini key. In Settings you can later add a key for a second provider,
  replace a revoked key, and pick the provider, model, and reasoning
  effort. Changes apply to the next brief without a restart.

## Benefits

**Privacy.** Your calendar, email, Slack, Notion, and the briefs Olly writes
are stored only on your machine. The only data that leaves it is what Olly
sends to the LLM provider you choose, plus the API calls to the services you
connect. Nothing is sent to the people who wrote Olly.

**Security.** Every install generates its own database password, session
secret, and field encryption key on first launch. No two installs share
them, and none of them ship inside the installer. Your LLM key is never in
the installer either; you enter it on first run.

**Control.** You own the process. Quit the app and everything stops. Delete
the app data folder and the copy on your machine is gone; whatever was sent
to your LLM provider stays under that provider's retention policy. Pick the
model, rotate your key, or move to a different provider whenever you like.

**No operator.** There is no Olly server, no Olly account, and no billing
beyond your own LLM usage. Apart from your LLM provider and the services you
connect, nobody else receives your data.

## What stays on your machine

| Data | Where | Protected by |
|---|---|---|
| Database (briefs, meetings, people, action items, ingested content) | `postgres-data/` in the app data folder | Your OS user account and disk encryption |
| OAuth tokens for Google and Slack, and pasted tokens for Notion, Jira, Airtable | Encrypted columns in that database | Per-install field encryption key |
| Per-install secrets (Postgres password, session secret, encryption key) | `state.json` in the app data folder | Your OS user account and disk encryption |
| LLM provider and API key | `secrets.env` in the app data folder | Your OS user account and disk encryption |

App data folders:

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/olly/` |
| Windows | `%APPDATA%\olly\` |

Be honest with yourself about what "encrypted" means here. Field encryption
covers tokens and credentials only. Brief contents and the calendar, email,
Slack, and Notion text that Olly ingests are stored as plain rows in the
local database. If someone has your OS user account, they can read them.
Turn on FileVault or BitLocker.

## What is bundled in the installer

The build copies your `apps/web/.env.local` into the app after removing a
fixed list of keys that must not ship: LLM keys, database URLs, session and
encryption secrets, push keys, telemetry keys, and model settings. Every
other line in the file ships as-is. If you write the minimal file shown in
the build guide, the installer contains only:

- Your Google OAuth client ID and secret
- Your Slack app client ID and secret, if you set one up
- `NEXTAUTH_URL=http://localhost:3000`

If you reuse a full development `.env.local` instead, its other values,
such as `CRON_SECRET` or any custom variables, ship too.

The Google client secret is inside the app bundle in plaintext. That is how
desktop OAuth clients work, and Google treats it as non-confidential for
installed apps. Anyone you give the installer to can use your OAuth client.
If you only build for yourself and keep the installer private, this is a
non-issue. A build made in a public GitHub repository, including a fork,
is not private; see the build guide.

## What will not work, or works differently

Olly Desktop is one machine, one user, running only while the app is open.
Compared with a [self-hosted server](self-hosting.md):

- **Nothing runs while the app is closed or the machine is asleep.** The
  job loop lives inside the app. A morning brief scheduled for 7:00 will not
  exist until you open Olly, at which point a catch-up tick runs. There is
  no background service or launch agent.
- **Meeting scheduling polls only while open.** The Gmail negotiation flow
  checks for replies every five minutes, but only while Olly is running.
- **Calendar changes made less than an hour ahead may be missed.** Olly
  re-reads your calendar on the interval set in Settings, hourly by
  default, and queues meeting briefs from that copy. A meeting created or
  moved after the last check, to a time less than one check away, gets no
  automatic brief and no email. The dashboard is not affected, because it
  reads your calendar live. For such a meeting, open the dashboard and
  click **Generate brief** on the meeting card; the brief and its email
  follow within a minute. On the desktop you can safely set the check to
  every 15 minutes; the extra work runs only on your own machine.
- **Brief emails are sent when the brief is generated**, from your own
  Gmail account, so they follow the same rule: a meeting brief set to
  arrive five minutes before a meeting is only sent if Olly is open then.
- **Single user.** One Google account per install. There is no team, no
  sharing, and no admin dashboard worth looking at.
- **No push notifications.** Electron has no push service, so the VAPID keys
  are stripped and the notification settings do nothing.
- **No hosted URL.** You cannot open Olly from your phone or another
  computer.
- **Port 3000 must be free.** The app refuses to start if something else is
  listening on it.
- **Closing the window quits the app** on every platform, including macOS.
- **No telemetry, no tracing.** Langfuse and New Relic keys are stripped.
  That is a feature for privacy and a limitation for debugging.
- **Jira and Airtable can be connected but do not feed briefs.** They have
  connect pages and status badges, but no agent tool reads from them yet.
  Jira is used by the user-story generator for issue export.
- **Unsigned builds.** Your Mac will warn that the developer cannot be
  verified. Windows SmartScreen will warn too. See the build guide for how
  to open the app anyway, or sign it with your own certificate.

## Platform support

"Builds" means the build scripts produce an installer for it. It is not a
promise of support.

| Platform | Status |
|---|---|
| macOS, Apple Silicon | Builds, as `-arm64.dmg` |
| macOS, Intel | Builds, as the `.dmg` without an arch suffix |
| Windows 10 and 11, x64 | Builds, as an NSIS `.exe` |
| Linux | Not built. The embedded Postgres package and build targets are not configured for it. |

## Updating, resetting, and uninstalling

- **Update.** Install the new build over the old one. The app data folder
  is left alone and new database migrations apply on the next launch.
- **Reset only the LLM key.** Quit Olly and delete `secrets.env` from the app
  data folder. The setup screen appears on the next launch.
- **Start from scratch.** Quit Olly and delete the whole app data folder.
  (A fork renamed with its own `productName` keeps the database and
  `state.json` in a folder of that name, while `secrets.env` stays in
  `olly`; delete both.)
  You lose every brief and every connection. On Windows, uninstalling from
  Settings does this automatically.
- **Never edit `state.json` by hand.** Changing the encryption key makes
  every stored token unreadable, and changing the Postgres password locks
  you out of your own database.
