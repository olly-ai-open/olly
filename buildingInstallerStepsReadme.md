# Building Olly Desktop Installers

Living document for building and testing the Olly desktop app installers
(Mac DMGs for Intel + Apple Silicon, Windows EXE). Keep this up to date as the
build process evolves.

Last updated: 2026-06-24

---

## Overview

Olly desktop is an Electron app that bundles the Next.js web app (standalone
server), an embedded PostgreSQL, and Prisma migrations. Installers are produced
with `electron-builder`, configured in the root `package.json` `build` block.

### What gets built

| Platform | Target | Arch | Output |
|----------|--------|------|--------|
| macOS | `dmg` + `zip` | `x64` (Intel) + `arm64` (Apple Silicon) | 2 DMGs + 2 ZIPs |
| Windows | `nsis` | x64 | `.exe` installer |

Build output lands in `dist/` at the repo root.

---

## Prerequisites

- **Node.js 22** and npm.
- Run all commands from the **repo root** (`/Users/<you>/Documents/Cursor/Olly`).
- `npm install` has been run (workspaces + electron/electron-builder devDeps present).
- `apps/web/.env.local` exists — it is bundled into the app as `env/.env.local`
  and carries OAuth client creds (Google/Slack), `NEXTAUTH_SECRET`, etc.
  LLM keys are NOT required here; users provide those at first run (see below).
- For Mac: building both archs works from either an Intel or Apple Silicon Mac.
  The embedded Postgres binaries for both Mac archs are pulled in via
  `optionalDependencies` (`@embedded-postgres/darwin-x64`, `@embedded-postgres/darwin-arm64`).

> ⚠️ Known caveat (line 14 of root `package.json`): `build:web` sets
> `NODE_OPTIONS` using Windows `set` syntax, which is a no-op on macOS. If Mac
> builds hit out-of-memory during the Next build, export it manually first:
> `export NODE_OPTIONS=--max-old-space-size=8192`.

---

## Build commands (Mac)

From the repo root:

```bash
# Build BOTH Intel (x64) and Apple Silicon (arm64) DMGs + ZIPs
npm run dist:mac
```

`dist:mac` expands to:
1. `build:web` — Next.js production build of `apps/web` (standalone server)
2. `copy:standalone-assets` — copies `.next/standalone` + static assets into the package
3. `copy:prisma-resources` — copies Prisma engine/client so migrations run in-app
4. `build:packaged-env` — copies `apps/web/.env.local` -> `apps/web/.env.packaged.local`,
   stripping LLM keys (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `LLM_PROVIDER`).
   This sanitized file is what gets bundled as `env/.env.local`.
5. `check:packaged-env` — safety net (see below).
6. `electron-builder --mac --publish never` — packages the DMGs/ZIPs

`dist:win` runs the same steps 1–5, then `electron-builder --win nsis`. Steps 4
and 5 are shared by both platforms because `extraResources` (which bundles the
env) is global, not under the `mac` block — so the Windows EXE gets the same
sanitized env and the same guard.

### The `check:packaged-env` guard

Runs after `build:packaged-env`, before packaging. Scans the about-to-be-bundled
`apps/web/.env.packaged.local` for LLM API keys (incl. commented ones, which
still embed a real secret). Behaviour:

- **No keys** → prints OK, continues.
- **Keys found, interactive terminal** → prints a warning listing the offending
  lines and prompts `Continue building anyway? [y/N]`. `y`/`yes` continues;
  anything else aborts the build. (Warns, does not hard-fail — team friendly.)
- **Keys found, non-interactive (CI)** → warns and continues by default so
  automated builds aren't blocked. Set `OLLY_STRICT_ENV_CHECK=1` to abort instead.
- `OLLY_ALLOW_BUNDLED_LLM_KEYS=1` → acknowledge and skip the prompt entirely.

In normal operation step 4 strips the keys, so step 5 passes silently. The
prompt only appears if the strip is bypassed or a new LLM key name slips in.

### Artifacts produced (in `dist/`) — confirmed 2026-06-24

| File | Arch | Size | Notes |
|------|------|------|-------|
| `olly-1.0.2.dmg` | **Intel (x64)** | ~292 MB | ⚠️ No `-x64` suffix — the unsuffixed DMG is the Intel one |
| `olly-1.0.2-arm64.dmg` | **Apple Silicon (arm64)** | ~284 MB | |
| `olly-1.0.2-mac.zip` | Intel (x64) | ~280 MB | auto-update channel |
| `olly-1.0.2-arm64-mac.zip` | Apple Silicon (arm64) | ~272 MB | auto-update channel |

> ⚠️ **Important for the Intel test:** the Intel DMG is `olly-1.0.2.dmg`
> (the one WITHOUT an arch suffix). `-arm64` is Apple Silicon. Easy to grab the
> wrong one.

---

## Testing on the Intel Mac

1. Copy the **Intel DMG** (`olly-1.0.2.dmg` — the one with NO arch suffix) to the Intel Mac.
2. Open the DMG, drag **Olly** into `/Applications`.
3. Launch Olly. On first run it will:
   - Show a loading window ("Starting Olly...").
   - Download embedded Postgres (one-time, first launch only).
   - Apply database migrations.
   - Start the bundled Next.js server on `localhost:3000`.
   - Open the **/setup** screen if no LLM key is configured.
4. On the setup screen: pick provider (Claude/Anthropic or OpenAI), paste the
   API key, click Save.
5. **Restart Olly** (required — secrets are only read at startup).
6. After restart, the app should open to the main UI. Sign in via Google OAuth
   and exercise a morning brief to confirm the LLM key works end to end.

### What the app installs (PostgreSQL)

- The DMG ships an **embedded, app-private PostgreSQL** — binaries are bundled
  inside `Olly.app/Contents/Resources/app/node_modules/@embedded-postgres/darwin-*`
  for both Intel and Apple Silicon. No network download needed on Mac despite the
  "one-time download" loading message.
- **No system PostgreSQL is installed or touched.** No Homebrew/Postgres.app/5432.
  The embedded instance runs on **port 54329** with its own data dir.
- First launch runs `initdb` once, starts Postgres, creates the `olly` DB, and
  applies migrations (`electron/lib/postgres.js`, `electron/lib/migrations.js`).

### Where app data + user secrets live on the test machine (macOS)

Everything is under one folder: **`~/Library/Application Support/olly/`**
- `postgres-data/` — embedded Postgres data directory
- `state.json` — generated DB password + port
- `secrets.env` — saved LLM provider + API key

### Clean-slate reset (run on the test Mac before a fresh first-run test)

```bash
# 1. Fully quit Olly
pkill -f "olly" 2>/dev/null; pkill -f "Olly" 2>/dev/null
# 2. Remove any previously installed app
rm -rf /Applications/Olly.app
# 3. Remove ALL app data (DB + saved password + LLM key) -> true first run
rm -rf ~/Library/Application\ Support/olly
# 4. Optional: clear caches / saved state
rm -rf ~/Library/Caches/olly
rm -rf ~/Library/Saved\ Application\ State/*olly* 2>/dev/null
rm -f  ~/Library/Preferences/*olly*.plist 2>/dev/null
# 5. Ensure required ports are free
lsof -i :3000      # Next.js server (real conflict risk)
lsof -i :54329     # embedded Postgres
```

> You do NOT need to uninstall any system PostgreSQL — the embedded one is
> private and on port 54329. Only port 3000 is a likely real-world conflict.
> To reset ONLY the LLM-key setup flow (keep the DB), delete just
> `~/Library/Application Support/olly/secrets.env` and relaunch.

### Troubleshooting first-run

- **"Port 3000 already in use"**: quit whatever is using port 3000, relaunch.
- **Gatekeeper / unsigned app warning**: builds are currently `--publish never`
  and likely unsigned. Right-click → Open, or
  `xattr -dr com.apple.quarantine /Applications/Olly.app`.
- **Stuck on "Setting up local database"**: first-launch Postgres download;
  give it time and check network. Logs are prefixed `[olly-startup]`.
- **Migrations fail**: confirm `prisma/migrations` and `schema.prisma` were
  bundled (they're listed under `extraResources`).

---

## How the pieces fit (reference)

- Electron entry: `electron/main.js` (bootstrap order documented at top of file).
- Per-OS user secrets: `electron/lib/user-secrets.js`.
- First-run gate: `apps/web/src/middleware.ts` redirects to `/setup` when no
  LLM key is present.
- Setup UI: `apps/web/src/app/setup/page.tsx`.
- Setup API: `apps/web/src/app/api/setup/secrets/route.ts` (writes `secrets.env`).
- electron-builder config: root `package.json` `build` block.

---

## Results log

Record each build/test attempt here so we can track regressions and improvements.

### 2026-06-24 — Initial Mac dual-arch build
- Command: `NODE_OPTIONS=--max-old-space-size=8192 npm run dist:mac`
- Result: ✅ **SUCCESS** (exit code 0). Both archs built and signed.
- Artifacts produced:
  - `olly-1.0.2.dmg` (Intel/x64, ~292 MB)
  - `olly-1.0.2-arm64.dmg` (Apple Silicon, ~284 MB)
  - matching `-mac.zip` / `-arm64-mac.zip` files
- Signing: signed with **Apple Development** cert
  (`Apple Development: your-apple-id@example.com`), NOT Developer ID.
  - ⚠️ Apple Development certs are for local/dev machines tied to the same
    Apple ID/provisioning. On a *different* Intel Mac this will likely still
    trip Gatekeeper. Plan to right-click→Open or `xattr -dr com.apple.quarantine`,
    or move to Developer ID + notarization for real distribution.
- Notarization: **skipped** (`notarize` options could not be generated).
- App icon: default Electron icon (no custom icon set yet).
- Intel Mac test outcome: ⚠️ **Setup flow did NOT appear.** App launched
  straight to the main UI without prompting for an LLM key.
- Root cause: the bundled `env/.env.local` shipped live `ANTHROPIC_API_KEY` +
  `OPENAI_API_KEY` (copied wholesale from `apps/web/.env.local`). The setup gate
  keys off "is an LLM key present in env" (`hasRequiredLlmEnv()` in
  `electron/lib/user-secrets.js`; also `middleware.ts`), so a baked-in key makes
  the app think setup is already complete. Cleaning per-user data on the test
  machine can't fix this — the key was inside the DMG, not in user data.
- ⚠️ **Security:** that first DMG contains live API keys in plaintext at
  `Contents/Resources/env/.env.local`. Rotation **waived** (2026-06-24): keys
  are used only for the developer's own solo testing and the DMG has not been
  shared with anyone. Revisit if a DMG is ever distributed externally — at that
  point rotate the keys (the build now strips them from the bundle anyway).

### 2026-06-24 (later) — Fix: strip LLM keys from packaged env
- Added `electron/scripts/build-packaged-env.js` + `npm run build:packaged-env`,
  wired into `dist:mac`/`dist:win`/`electron:build`. It copies
  `apps/web/.env.local` -> `apps/web/.env.packaged.local`, stripping
  `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `LLM_PROVIDER` (incl. commented lines).
- `extraResources` now bundles `.env.packaged.local` (gitignored) as
  `env/.env.local` instead of the raw dev file.
- Verified: generated file has 0 LLM key lines, keeps the 29 other (OAuth/auth)
  keys. Dev `apps/web/.env.local` is left untouched so `npm run dev` still works.
- Rebuild outcome: ✅ rebuilt `npm run dist:mac` (exit 0). Verified the new
  bundled `env/.env.local` has **0 LLM key lines** and keeps the 29 other keys.
  Fresh DMGs: `olly-1.0.2.dmg` (Intel), `olly-1.0.2-arm64.dmg` (Apple Silicon).
- Intel re-test outcome: _(pending — expect /setup screen on first run)_

---

## Future improvements (backlog)

- [ ] Fix `NODE_OPTIONS` cross-platform setting in `build:web` (use `cross-env`).
- [ ] Switch Mac signing from **Apple Development** to **Developer ID** + notarization (current builds will trip Gatekeeper on other machines).
- [ ] Add a custom app icon (currently using the default Electron icon).
- [ ] Consider a universal Mac DMG vs. separate x64/arm64.
- [ ] Hot-reload of `secrets.env` so setup doesn't require an app restart.
- [ ] De-duplicate env-parsing logic shared between electron lib and API route.
- [ ] Document and script the Windows EXE build/test flow in this doc.
