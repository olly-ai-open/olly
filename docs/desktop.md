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
- A first-run setup screen where you paste your own OpenAI or Anthropic key.

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
one folder and every trace of your data is gone. Pick the model, rotate your
key, or move to a different provider whenever you like.

**No operator.** There is no server, no account with a third party, no
billing beyond your own LLM usage, and no one else with access to your data.

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

The build copies a sanitized version of your `apps/web/.env.local` into the
app. After stripping, it contains only:

- Your Google OAuth client ID and secret
- Your Slack app client ID and secret, if you set one up
- Optional model names and temperature
- `NEXTAUTH_URL=http://localhost:3000`

The Google client secret is inside the app bundle in plaintext. That is how
desktop OAuth clients work, and Google treats it as non-confidential for
installed apps. Anyone you give the installer to can use your OAuth client.
If you only build for yourself, this is a non-issue.

## What will not work, or works differently

Olly Desktop is one machine, one user, running only while the app is open.
Compared with a [self-hosted server](self-hosting.md):

- **Nothing runs while the app is closed or the machine is asleep.** The
  job loop lives inside the app. A morning brief scheduled for 7:00 will not
  exist until you open Olly, at which point a catch-up tick runs. There is
  no background service or launch agent.
- **Meeting scheduling polls only while open.** The Gmail negotiation flow
  checks for replies every five minutes, but only while Olly is running.
- **Meetings added at short notice may be missed.** Olly re-reads your
  calendar on the interval set in Settings, hourly by default. On the
  desktop you can safely set it to every 15 minutes; the extra work runs
  only on your own machine.
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
- **Only OpenAI and Anthropic keys** can be entered on the setup screen.
  Gemini works on a server through environment variables but not on desktop.
- **Saving a new LLM key restarts the app.** Keys are read at startup.
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

| Platform | Status |
|---|---|
| macOS, Apple Silicon | Supported, built as `-arm64.dmg` |
| macOS, Intel | Supported, built as the `.dmg` without an arch suffix |
| Windows 10 and 11, x64 | Supported, built as an NSIS `.exe` |
| Linux | Not supported. The embedded Postgres package and build targets are not configured for it. |

## Updating, resetting, and uninstalling

- **Update.** Install the new build over the old one. The app data folder
  is left alone and new database migrations apply on the next launch.
- **Reset only the LLM key.** Quit Olly and delete `secrets.env` from the app
  data folder. The setup screen appears on the next launch.
- **Start from scratch.** Quit Olly and delete the whole app data folder.
  You lose every brief and every connection. On Windows, uninstalling from
  Settings does this automatically.
- **Never edit `state.json` by hand.** Changing the encryption key makes
  every stored token unreadable, and changing the Postgres password locks
  you out of your own database.
