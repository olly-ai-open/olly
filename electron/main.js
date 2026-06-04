/**
 * Olly desktop entry point.
 *
 * Bootstrap order:
 *   1. Show loading window
 *   2. Load env (.env.local)
 *   3. Ensure local Postgres is running (embedded; downloads on first launch)
 *   4. Apply database migrations
 *   5. Spawn Next.js standalone server
 *   6. Open the app window
 *
 * Heavy lifting lives in `electron/lib/*` modules; this file orchestrates.
 */

const { app } = require("electron");
const fs = require("node:fs");
const dotenv = require("dotenv");

const paths = require("./lib/paths");
const ui = require("./lib/ui");
const server = require("./lib/server");
const postgres = require("./lib/postgres");
const migrations = require("./lib/migrations");

const APP_PORT = 3000;
const FALLBACK_AUTH_SECRET = "olly-desktop-local-secret-change-this";

let mainWindow = null;
let webServer = null;

function log(...args) {
  console.log("[olly-startup]", ...args);
}

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

  ui.showLoading(
    mainWindow,
    "Setting up local database (one-time download on first launch)...",
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

  const authSecret =
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    FALLBACK_AUTH_SECRET;

  webServer = server.startNextServer({
    port: APP_PORT,
    env: {
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
      AUTH_SECRET: authSecret,
      NEXTAUTH_SECRET: authSecret,
      NEXTAUTH_URL: `http://localhost:${APP_PORT}`,
      AUTH_URL: `http://localhost:${APP_PORT}`,
    },
    log,
  });

  await server.waitForServer(APP_PORT);

  await mainWindow.loadURL(`http://localhost:${APP_PORT}`);
}

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
  server.stopNextServer(webServer);
  try {
    await postgres.stopPostgres(log);
  } catch (err) {
    log("Shutdown error:", err && err.message);
  }
}

app.on("window-all-closed", async () => {
  await shutdown();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  await shutdown();
});
