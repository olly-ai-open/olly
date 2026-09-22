/**
 * Olly desktop entry point.
 *
 * Bootstrap order:
 *   1. Show loading window
 *   2. Load env (.env.local)
 *   3. Load user secrets overlay (secrets.env)
 *   4. Ensure local Postgres is running (embedded, bundled with the app)
 *   5. Apply database migrations
 *   6. Spawn Next.js standalone server
 *   7. Open the app window (or setup flow if LLM keys are missing)
 *
 * Heavy lifting lives in `electron/lib/*` modules; this file orchestrates.
 */
const {
  applyUserSecretsToProcessEnv,
  hasRequiredLlmEnv,
} = require("./lib/user-secrets");
const { app, ipcMain, powerMonitor, session } = require("electron");
const fs = require("node:fs");
const dotenv = require("dotenv");

const paths = require("./lib/paths");
const ui = require("./lib/ui");
const server = require("./lib/server");
const postgres = require("./lib/postgres");
const migrations = require("./lib/migrations");
const cron = require("./lib/cron");
const state = require("./lib/state");
const { randomBytes } = require("node:crypto");

const APP_PORT = 3000;

let mainWindow = null;
let webServer = null;
let cronLoop = null;

function log(...args) {
  console.log("[olly-startup]", ...args);
}

// embedded-postgres registers its own AsyncExitHook whose gracefulShutdown()
// unconditionally calls done(). On Node's synchronous 'exit' event,
// async-exit-hook invokes the hook with no callback, so done is undefined and
// `done()` throws "done is not a function" as an unhandled rejection on every
// quit. We already stop Postgres cleanly in shutdown(), so this is harmless
// noise — swallow only this exact error and surface anything else.
process.on("unhandledRejection", (reason) => {
  const message = reason && reason.message ? String(reason.message) : String(reason);
  if (reason instanceof TypeError && message.includes("done is not a function")) {
    return;
  }
  log("Unhandled rejection:", message);
});

function loadPackagedEnv() {
  const candidates = app.isPackaged
    ? [paths.getPackagedEnvPath()]
    : [paths.getDevEnvPath()];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: true });
      log("Loaded env file:", envPath);
      return;
    }
  }

  log("No .env.local found; continuing with empty env");
}

/**
 * Decide whether to use an external DATABASE_URL (dev convenience)
 * or the embedded Postgres (always for packaged builds).
 *
 * `ownsDatabase` indicates whether the desktop app manages the DB
 * lifecycle. We only apply migrations when we own the DB; an
 * external dev DB is managed by the developer's `prisma migrate`
 * workflow.
 */
async function ensureDatabase() {
  const externalUrl = process.env.DATABASE_URL;

  if (!app.isPackaged && externalUrl) {
    log("Using external DATABASE_URL from env (dev mode)");
    return { databaseUrl: externalUrl, ownsDatabase: false };
  }

  const result = await postgres.ensurePostgresRunning(log);
  return { ...result, ownsDatabase: true };
}

async function bootstrap() {
  mainWindow = ui.createMainWindow();
  ui.showLoading(mainWindow, "Starting Olly...");

  loadPackagedEnv();
  applyUserSecretsToProcessEnv();

  const needsLlmSetup = !hasRequiredLlmEnv();
  log("LLM setup required:", needsLlmSetup);

  ui.showLoading(
    mainWindow,
    "Setting up local database (initialised on first launch)...",
  );
  const { databaseUrl, ownsDatabase } = await ensureDatabase();

  if (ownsDatabase) {
    ui.showLoading(mainWindow, "Applying database migrations...");
    await migrations.runMigrations(databaseUrl, log);
  } else {
    log("Skipping migrations (external DB is developer-managed)");
  }

  ui.showLoading(mainWindow, "Starting the Olly app...");

  if (await server.isPortOpen(APP_PORT)) {
    throw new Error(
      `Port ${APP_PORT} is already in use. Please free it before launching Olly.`,
    );
  }

  // Per-install secrets. When the app owns its embedded database, the session
  // secret and the field encryption key are generated on first launch and
  // stored in state.json, so no two installs share them and nothing secret
  // has to ship inside the installer. A developer pointing at an external
  // DATABASE_URL keeps using the values from .env.local, because that
  // database was encrypted with their key.
  let authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  let fieldEncryptionKey = process.env.PRISMA_FIELD_ENCRYPTION_KEY;
  if (ownsDatabase) {
    const installSecrets = state.ensureInstallSecrets();
    authSecret = installSecrets.authSecret;
    fieldEncryptionKey = installSecrets.fieldEncryptionKey;
  } else if (!authSecret) {
    throw new Error(
      "AUTH_SECRET or NEXTAUTH_SECRET must be set in apps/web/.env.local when using an external DATABASE_URL.",
    );
  }

  // The cron routes require a secret in production builds; generate one per
  // session so only this Electron process can drive the local job loop.
  const cronSecret =
    process.env.CRON_SECRET || randomBytes(24).toString("hex");

  webServer = server.startNextServer({
    port: APP_PORT,
    env: {
      OLLY_DESKTOP: "1",
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
      AUTH_SECRET: authSecret,
      NEXTAUTH_SECRET: authSecret,
      PRISMA_FIELD_ENCRYPTION_KEY: fieldEncryptionKey || "",
      NEXTAUTH_URL: `http://localhost:${APP_PORT}`,
      AUTH_URL: `http://localhost:${APP_PORT}`,
      LLM_PROVIDER: process.env.LLM_PROVIDER || "",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
      CRON_SECRET: cronSecret,
    },
    log,
  });

  await server.waitForServer(APP_PORT);

  // Scheduled briefs and meeting-scheduling negotiations run through the
  // job loop; on desktop we drive it ourselves while the app is open.
  cronLoop = cron.startCronLoop({ port: APP_PORT, secret: cronSecret, log });

  // Timers are frozen while the Mac sleeps, so ticks silently stop firing.
  // Run a catch-up tick as soon as the machine wakes.
  powerMonitor.on("resume", () => {
    log("[cron] system resumed — running catch-up tick");
    if (cronLoop) cronLoop.runNow();
  });

  // The setup screen sets a cookie so the first-run gate opens without a
  // restart. On launch the environment is the truth again, so drop it.
  try {
    await session.defaultSession.cookies.remove(
      `http://localhost:${APP_PORT}`,
      "olly_llm_ready",
    );
  } catch (err) {
    log("Could not clear the setup cookie:", err && err.message);
  }

  const targetUrl = needsLlmSetup
    ? `http://localhost:${APP_PORT}/setup`
    : `http://localhost:${APP_PORT}`;

  log("Opening URL:", targetUrl);
  await mainWindow.loadURL(targetUrl);
}

/**
 * Relaunch the app cleanly. The setup screen calls this after saving the
 * LLM key so the new instance boots with the key in its env. We stop the
 * server + embedded Postgres first so the relaunched instance doesn't find
 * the DB port still held.
 */
ipcMain.on("olly:restart", async () => {
  log("Restart requested from renderer");
  try {
    await shutdown();
  } catch (err) {
    log("Restart shutdown error:", err && err.message);
  }
  app.relaunch();
  app.exit(0);
});

app.whenReady().then(async () => {
  try {
    await bootstrap();
  } catch (err) {
    const message =
      err instanceof Error ? err.stack || err.message : String(err);
    log("Startup failed:", message);
    ui.showError(mainWindow, "Olly failed to start", message);
  }
});

async function shutdown() {
  if (cronLoop) {
    cronLoop.stop();
    cronLoop = null;
  }
  server.stopNextServer(webServer);

  try {
    await postgres.stopPostgres(log);
  } catch (err) {
    log("Shutdown error:", err && err.message);
  }
}

app.on("window-all-closed", async () => {
  await shutdown();
  // Quit on every platform when the window is closed. The usual macOS
  // convention keeps the app alive in the dock after the window closes, but
  // for Olly closing the window should fully quit (same as Olly → Quit).
  app.quit();
});

app.on("before-quit", async () => {
  await shutdown();
});