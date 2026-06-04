/**
 * Apply Prisma SQL migrations against the configured database.
 *
 * We don't bundle the Prisma CLI (which is heavy and devDependency-only).
 * Instead we read each `migrations/<name>/migration.sql`, execute it in a
 * transaction, and record success in Prisma's standard `_prisma_migrations`
 * table. That keeps this runtime compatible with `prisma migrate deploy`
 * if developers later run it against the same database.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { getMigrationsDir } = require("./paths");

const PRISMA_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" varchar(36) NOT NULL,
    "checksum" varchar(64) NOT NULL,
    "finished_at" timestamptz,
    "migration_name" varchar(255) NOT NULL,
    "logs" text,
    "rolled_back_at" timestamptz,
    "started_at" timestamptz NOT NULL DEFAULT now(),
    "applied_steps_count" integer NOT NULL DEFAULT 0,
    PRIMARY KEY ("id")
  );
`;

function checksum(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

function listMigrationDirs(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

async function runMigrations(databaseUrl, log = console.log) {
  const { Client } = require("pg");
  const migrationsDir = getMigrationsDir();
  log(`[migrations] dir: ${migrationsDir}`);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(PRISMA_MIGRATIONS_TABLE_SQL);

    const { rows } = await client.query(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    const applied = new Set(rows.map((r) => r.migration_name));

    const dirs = listMigrationDirs(migrationsDir);
    log(`[migrations] discovered ${dirs.length} migration(s)`);

    let appliedCount = 0;
    for (const name of dirs) {
      if (applied.has(name)) continue;

      const sqlFile = path.join(migrationsDir, name, "migration.sql");
      if (!fs.existsSync(sqlFile)) {
        log(`[migrations] skipping ${name}: no migration.sql`);
        continue;
      }
      const sql = fs.readFileSync(sqlFile, "utf8");

      log(`[migrations] applying: ${name}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations"
            (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
           VALUES ($1, $2, $3, now(), now(), 1)`,
          [crypto.randomUUID(), checksum(sql), name],
        );
        await client.query("COMMIT");
        appliedCount++;
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${name} failed: ${err.message}`);
      }
    }

    log(`[migrations] applied ${appliedCount} new migration(s)`);
  } finally {
    await client.end();
  }
}

module.exports = { runMigrations };
