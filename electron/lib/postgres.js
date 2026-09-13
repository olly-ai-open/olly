/**
 * Embedded PostgreSQL lifecycle for the desktop app.
 *
 * Uses the `embedded-postgres` package. The platform binaries are
 * bundled with the app (see optionalDependencies in package.json),
 * so no download happens at runtime; `initdb` runs once on first
 * launch. We keep the data dir under userData so user data persists
 * across upgrades and reinstalls.
 *
 * `embedded-postgres` is ESM-only, so we load it via dynamic
 * import from this CommonJS module.
 */

const fs = require("node:fs");
const path = require("node:path");

const { getPostgresDataDir } = require("./paths");
const { loadState, saveState, generatePassword } = require("./state");

const DEFAULT_PORT = 54329;
const POSTGRES_USER = "olly";
const POSTGRES_DB = "olly";

let runningInstance = null;
let EmbeddedPostgresClassPromise = null;

async function loadEmbeddedPostgresClass() {
  if (!EmbeddedPostgresClassPromise) {
    EmbeddedPostgresClassPromise = import("embedded-postgres").then(
      (mod) => mod.default || mod.EmbeddedPostgres || mod,
    );
  }
  return EmbeddedPostgresClassPromise;
}

function buildDatabaseUrl({ port, password }) {
  return `postgresql://${POSTGRES_USER}:${encodeURIComponent(
    password,
  )}@127.0.0.1:${port}/${POSTGRES_DB}?schema=public`;
}

async function ensurePostgresRunning(log = console.log) {
  const EmbeddedPostgres = await loadEmbeddedPostgresClass();

  const state = loadState();
  if (!state.postgresPassword) state.postgresPassword = generatePassword();
  if (!state.postgresPort) state.postgresPort = DEFAULT_PORT;
  saveState(state);

  const databaseDir = getPostgresDataDir();
  const initialised = fs.existsSync(path.join(databaseDir, "PG_VERSION"));

  log(`[postgres] data dir: ${databaseDir}`);
  log(`[postgres] initialised: ${initialised}`);

  const pg = new EmbeddedPostgres({
    databaseDir,
    user: POSTGRES_USER,
    password: state.postgresPassword,
    port: state.postgresPort,
    persistent: true,
  });

  if (!initialised) {
    log("[postgres] running initdb (one-time)...");
    await pg.initialise();
  }

  log(`[postgres] starting on port ${state.postgresPort}...`);
  await pg.start();

  // Check for the database before creating it. Issuing CREATE DATABASE
  // unconditionally makes Postgres log a scary server-side
  // `ERROR: database "olly" already exists` on every launch after the first,
  // even though we catch it. Probing pg_database first keeps the log clean.
  let dbExists = false;
  const probe = pg.getPgClient();
  try {
    await probe.connect();
    const res = await probe.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [POSTGRES_DB],
    );
    dbExists = res.rowCount > 0;
  } finally {
    await probe.end().catch(() => {});
  }

  if (dbExists) {
    log(`[postgres] database "${POSTGRES_DB}" already exists`);
  } else {
    try {
      await pg.createDatabase(POSTGRES_DB);
      log(`[postgres] created database "${POSTGRES_DB}"`);
    } catch (err) {
      // Tolerate a race (another launch created it between probe and create).
      if (!String(err && err.message).toLowerCase().includes("already exists")) {
        throw err;
      }
      log(`[postgres] database "${POSTGRES_DB}" already exists`);
    }
  }

  runningInstance = pg;

  return {
    databaseUrl: buildDatabaseUrl({
      port: state.postgresPort,
      password: state.postgresPassword,
    }),
  };
}

async function stopPostgres(log = console.log) {
  if (!runningInstance) return;
  log("[postgres] stopping...");
  try {
    await runningInstance.stop();
  } catch (err) {
    log("[postgres] stop error:", err && err.message);
  }
  runningInstance = null;
}

module.exports = { ensurePostgresRunning, stopPostgres };
