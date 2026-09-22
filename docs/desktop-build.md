# Build the desktop app

This guide takes you from a clean clone to a Mac DMG or a Windows installer
that signs in to Google and generates briefs. Read [Olly Desktop](desktop.md)
first if you have not.

Building takes about ten minutes on a laptop and twenty on GitHub Actions.
The one part that takes real effort is creating your own Google OAuth
client, which you must do exactly once.

## 1. Prerequisites

- Node.js 22 and npm 10 or newer.
- For a Mac build: any Mac. One build produces both Intel and Apple Silicon
  installers.
- For a Windows build: a Windows machine, or GitHub Actions in your own
  fork. There is no cross-compilation from a Mac.
- A Google account for the Google Cloud console.
- An OpenAI or Anthropic API key. You enter it in the app, not at build time.

## 2. Create your Google OAuth client

Olly signs users in with Google and reads their Calendar, Gmail, and Drive.
Google requires every app that does this to have its own OAuth client. You
cannot skip this step, and the repository does not ship one.

1. Go to the [Google Cloud console](https://console.cloud.google.com/) and
   create a project, for example "Olly personal".
2. Enable these APIs under **APIs and services, Library**: Google Calendar
   API, Gmail API, and Google Drive API.
3. Open **APIs and services, OAuth consent screen**. Choose **External**
   unless you have a Google Workspace organisation and want to restrict the
   app to it, in which case choose **Internal** and skip the verification
   discussion below.
4. Fill in the app name and your email. Add these scopes:

   ```
   openid
   email
   profile
   https://www.googleapis.com/auth/calendar.readonly
   https://www.googleapis.com/auth/calendar.events
   https://www.googleapis.com/auth/drive.readonly
   https://www.googleapis.com/auth/drive.file
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   ```

5. Open **Credentials**, create an **OAuth client ID** of type
   **Web application** (not Desktop; Olly's server runs inside the app and
   uses browser redirects), and add both redirect URIs:

   ```
   http://localhost:3000/api/auth/callback/google
   http://localhost:3000/api/auth/google-connect/callback
   ```

6. Copy the client ID and client secret.

### Testing mode or published

A new consent screen starts in **Testing** status. Two things follow from
that, and one of them will bite you:

- Only email addresses you list as **test users** can sign in. Add your own.
- **Refresh tokens expire after seven days.** Olly will lose access to your
  Google data weekly and you will have to reconnect on the Integrations page.

To stop the weekly expiry, press **Publish app** on the consent screen. You
do not need to complete Google's verification. Unverified published apps
show a "Google hasn't verified this app" warning that you click through
once, and are limited to 100 users. For a personal build that is the right
trade. Full verification of Gmail and Drive scopes requires a third-party
security assessment and is not realistic for a personal deployment.

## 3. Optional: create a Slack app

Skip this if you do not use Slack. Olly still builds and runs; the Slack
card on the Integrations page will report an error if you try to connect.

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps) from
   scratch, in your workspace.
2. Under **OAuth and Permissions**, add the redirect URL
   `http://localhost:3000/api/auth/slack-connect/callback`.
3. Add these **User Token Scopes**: `search:read`, `channels:history`,
   `groups:history`, `im:history`, `mpim:history`, `users:read`.
4. Copy the client ID and client secret from **Basic Information**.

Notion, Jira, and Airtable need no app-level setup. Each user pastes their
own token on the Integrations page.

## 4. Write the env file

Create `apps/web/.env.local` at the path shown. It is gitignored. The build
copies it into the installer after stripping everything that must not ship.

```bash
NEXTAUTH_URL=http://localhost:3000

GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Optional
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=

# Optional model overrides. The key itself is entered in the app.
OPENAI_MODEL=gpt-4.1-mini
ANTHROPIC_MODEL=claude-haiku-4-5-20251202
LLM_TEMPERATURE=0.2
```

Do not add an LLM key, a database URL, an auth secret, or an encryption key.
The build strips them, and if a stripped key somehow survives the build
prints a warning and asks before continuing. The app generates its own
secrets on first launch.

## 5. Build on a Mac

From the repository root:

```bash
npm install

# Once per machine. npm only installs the embedded Postgres binaries for
# the CPU you are on and silently skips the other one; the DMGs must ship
# both, so force each architecture in explicitly.
npm install --no-save --force --os darwin --cpu x64 @embedded-postgres/darwin-x64@17.9.0-beta.17
npm install --no-save --force --os darwin --cpu arm64 @embedded-postgres/darwin-arm64@17.9.0-beta.17

npm run dist:mac
```

The build runs the web app's production build, copies static assets and
Prisma engines into the standalone tree, writes the sanitized env, checks
it, confirms both Postgres architectures are present, and packages both
architectures. Output lands in `dist/`:

| File | For |
|---|---|
| `olly-<version>.dmg` | Intel Macs. There is no `-x64` suffix. |
| `olly-<version>-arm64.dmg` | Apple Silicon Macs |
| matching `.zip` files | Same apps, zipped |

**Signing.** If you have an Apple Developer certificate in your keychain,
electron-builder signs with it automatically. If not, the build falls back
to an ad-hoc signature and macOS will warn on first launch. To skip signing
deliberately, prefix the command with `CSC_IDENTITY_AUTO_DISCOVERY=false`.
Notarization is not configured.

## 6. Build for Windows

On a Windows machine, from the repository root in PowerShell or cmd:

```powershell
npm install
npm run dist:win
```

Output is `dist\olly Setup <version>.exe`. The installer is unsigned;
SmartScreen shows "Windows protected your PC", and **More info, Run anyway**
gets past it.

### Without a Windows machine: GitHub Actions in your fork

The repository ships two manual workflows, one for Mac and one for Windows,
so you can build either without owning the hardware.

1. Fork the repository on GitHub.
2. In your fork, open **Settings, Secrets and variables, Actions** and add
   a repository secret named `OLLY_WEB_ENV_LOCAL` whose value is the full
   contents of your `apps/web/.env.local`. From a terminal with the GitHub
   CLI:

   ```bash
   gh secret set OLLY_WEB_ENV_LOCAL --repo <you>/<fork> < apps/web/.env.local
   ```

3. Open the **Actions** tab, pick **Build Windows installer** or
   **Build macOS installers**, and press **Run workflow**. Or:

   ```bash
   gh workflow run "Build Windows installer" --repo <you>/<fork>
   gh run watch --repo <you>/<fork>
   gh run download --repo <you>/<fork> --name olly-windows-installer
   ```

4. Download the artifact from the finished run. Artifacts are kept for 14
   days.

Installers are large, and GitHub caps the artifact storage a repository can
use. If you build often, fill in the optional **release_tag** field when you
run the workflow, for example `desktop-latest`. The installers are then
attached to a GitHub release of that name instead of an artifact. Releases
have no such cap, and the release page is the easiest place to download
from another machine.

The workflows run the exact same npm scripts as a local build, with the
strict env check turned on so a build that would ship a forbidden key fails
instead of warning. CI builds get the run number stamped into the version,
for example `1.0.3-build.14`, so no two are alike.

## 7. First run

1. **Mac:** open the DMG and drag Olly to Applications. On first launch,
   right-click the app and choose **Open**, or run
   `xattr -dr com.apple.quarantine /Applications/olly.app`.
   **Windows:** run the installer. It creates a desktop shortcut.
2. Olly shows a loading window, initialises its private Postgres, applies
   migrations, and starts the local server. First launch takes longer.
3. The **setup screen** asks for an LLM provider and key. Save, and the
   dashboard opens. You can add other providers' keys later in Settings.
4. Sign in with Google. If your consent screen is in Testing mode, use an
   address you listed as a test user.
5. Open **Integrations** and connect Google (calendar, Gmail, Drive) and
   anything else you use.
6. Open **Settings**, check the timezone, and set your morning and evening
   brief times. Then generate a morning brief from the dashboard to confirm
   the LLM key works end to end.

## Troubleshooting

- **"Port 3000 is already in use."** Quit whatever is listening on it and
  relaunch. Olly does not pick another port.
- **The setup screen never appears and briefs fail.** An LLM key leaked
  into the bundle. Rebuild; the env check should have warned you.
- **Google sign-in shows "Access blocked" or "app not verified".** In
  Testing mode, add yourself as a test user. If published, click
  **Advanced, Go to olly (unsafe)** once.
- **Google disconnects every week.** Your consent screen is in Testing
  mode. Publish it, see step 2.
- **Slack connect returns an error page.** No Slack app credentials in the
  env file at build time.
- **Stuck on "Setting up local database".** Check the logs. On a Mac, run
  the app from a terminal to see them:
  `/Applications/olly.app/Contents/MacOS/olly`. Lines are prefixed
  `[olly-startup]`.
- **Migrations fail.** Confirm the build copied `prisma/migrations` and
  `prisma/schema.prisma` into the app's resources.
- **Clean-slate reset on a Mac:**

  ```bash
  pkill -f olly
  rm -rf /Applications/olly.app
  rm -rf ~/Library/Application\ Support/olly
  ```

  On Windows, uninstall from Settings; that wipes `%APPDATA%\olly`.

## How the pieces fit

- `electron/main.js` orchestrates startup. The bootstrap order is documented
  at the top of the file.
- `electron/lib/postgres.js` and `electron/lib/migrations.js` run the
  embedded database and apply the SQL migrations without the Prisma CLI.
- `electron/lib/state.js` generates and stores the per-install secrets.
- `electron/lib/cron.js` drives the scheduler and worker routes every minute.
- `electron/lib/user-secrets.js` and `apps/web/src/app/api/setup/secrets/route.ts`
  read and write `secrets.env`.
- `apps/web/src/middleware.ts` redirects to `/setup` when the desktop flag
  is set and no LLM key is present.
- `electron/scripts/build-packaged-env.js` and `check-packaged-env.js`
  produce and verify the sanitized env. The strip list is at the top of the
  first file; add to it whenever you add a secret that must not ship.
- The electron-builder configuration is the `build` block in the root
  `package.json`.
