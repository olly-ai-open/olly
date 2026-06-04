/**
 * One-time data migration script
 *
 * Moves secrets from legacy storage into the new encrypted Credential table:
 *   - Jira: from Integration.meta → Credential
 *   - Notion: from NotionCredential → Credential + Integration
 *   - AirtableCredential: from AirtableCredential → Credential + Integration
 *
 * Safe to run multiple times (uses upsert — will not duplicate data).
 * Run AFTER the Prisma migration (add_credential_table) has been applied.
 *
 * Usage:
 *   cd apps/web
 *   node scripts/migrate-credentials.mjs
 */

import { PrismaClient } from "@prisma/client";
import { fieldEncryptionExtension } from "prisma-field-encryption";

// ---------------------------------------------------------------------------
// Bootstrap Prisma with field encryption (same as lib/prisma.ts)
// ---------------------------------------------------------------------------
const encryptionKey = process.env.PRISMA_FIELD_ENCRYPTION_KEY;
if (!encryptionKey) {
  console.error("ERROR: PRISMA_FIELD_ENCRYPTION_KEY is not set.");
  console.error("Make sure you run this script from the apps/web directory");
  console.error("so that .env is picked up, or export the key manually.");
  process.exit(1);
}

const base = new PrismaClient({ log: ["error"] });
const prisma = base.$extends(fieldEncryptionExtension({ encryptionKey }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(msg) {
  console.log(`[migrate-credentials] ${msg}`);
}

// ---------------------------------------------------------------------------
// 1. Migrate Jira — Integration.meta → Credential
//    Old shape: Integration.meta = { accessToken, email, baseUrl }
//    New shape: Credential.data = { accessToken, email, baseUrl }
//              Integration.meta = { baseUrl }  (non-sensitive only)
// ---------------------------------------------------------------------------
async function migrateJira() {
  log("--- Jira ---");

  const jiraIntegrations = await prisma.integration.findMany({
    where: { provider: "jira", status: "connected" },
  });

  log(`Found ${jiraIntegrations.length} connected Jira integration(s).`);

  let migrated = 0;
  let skipped = 0;

  for (const integration of jiraIntegrations) {
    const meta = integration.meta;
    if (!meta?.accessToken || !meta?.email || !meta?.baseUrl) {
      log(`  User ${integration.userId}: no secrets in meta, skipping.`);
      skipped++;
      continue;
    }

    // Write secrets to Credential (encrypted automatically)
    await prisma.credential.upsert({
      where: { userId_provider: { userId: integration.userId, provider: "jira" } },
      update: {
        data: JSON.stringify({
          accessToken: meta.accessToken,
          email: meta.email,
          baseUrl: meta.baseUrl,
        }),
      },
      create: {
        userId: integration.userId,
        provider: "jira",
        data: JSON.stringify({
          accessToken: meta.accessToken,
          email: meta.email,
          baseUrl: meta.baseUrl,
        }),
      },
    });

    // Scrub secrets from Integration.meta — keep only baseUrl (non-sensitive)
    await prisma.integration.update({
      where: { id: integration.id },
      data: { meta: { baseUrl: meta.baseUrl } },
    });

    log(`  User ${integration.userId}: migrated ✓`);
    migrated++;
  }

  log(`Jira: ${migrated} migrated, ${skipped} skipped.`);
}

// ---------------------------------------------------------------------------
// 2. Migrate Notion — NotionCredential → Credential + Integration
//    NotionCredential has: accessToken (encrypted), workspaceId, workspaceName, botId
// ---------------------------------------------------------------------------
async function migrateNotion() {
  log("--- Notion ---");

  const notionCredentials = await prisma.notionCredential.findMany();

  log(`Found ${notionCredentials.length} NotionCredential record(s).`);

  let migrated = 0;
  let skipped = 0;

  for (const cred of notionCredentials) {
    if (!cred.accessToken) {
      log(`  User ${cred.userId}: no accessToken, skipping.`);
      skipped++;
      continue;
    }

    await Promise.all([
      // Ensure Integration row exists with status
      prisma.integration.upsert({
        where: { userId_provider: { userId: cred.userId, provider: "notion" } },
        update: { status: "connected", meta: { workspaceName: cred.workspaceName ?? null } },
        create: {
          userId: cred.userId,
          provider: "notion",
          status: "connected",
          meta: { workspaceName: cred.workspaceName ?? null },
        },
      }),
      // Write encrypted secrets to Credential
      prisma.credential.upsert({
        where: { userId_provider: { userId: cred.userId, provider: "notion" } },
        update: {
          data: JSON.stringify({
            accessToken: cred.accessToken,
            workspaceId: cred.workspaceId,
            workspaceName: cred.workspaceName ?? null,
            botId: cred.botId,
          }),
        },
        create: {
          userId: cred.userId,
          provider: "notion",
          data: JSON.stringify({
            accessToken: cred.accessToken,
            workspaceId: cred.workspaceId,
            workspaceName: cred.workspaceName ?? null,
            botId: cred.botId,
          }),
        },
      }),
    ]);

    log(`  User ${cred.userId}: migrated ✓`);
    migrated++;
  }

  log(`Notion: ${migrated} migrated, ${skipped} skipped.`);
}

// ---------------------------------------------------------------------------
// 3. Migrate AirtableCredential → Credential + Integration
// ---------------------------------------------------------------------------
async function migrateAirtable() {
  log("--- Airtable ---");

  const airtableCredentials = await prisma.airtableCredential.findMany();

  log(`Found ${airtableCredentials.length} AirtableCredential record(s).`);

  let migrated = 0;
  let skipped = 0;

  for (const cred of airtableCredentials) {
    if (!cred.accessToken) {
      log(`  User ${cred.userId}: no accessToken, skipping.`);
      skipped++;
      continue;
    }

    await Promise.all([
      prisma.integration.upsert({
        where: { userId_provider: { userId: cred.userId, provider: "airtable" } },
        update: { status: "connected" },
        create: { userId: cred.userId, provider: "airtable", status: "connected" },
      }),
      prisma.credential.upsert({
        where: { userId_provider: { userId: cred.userId, provider: "airtable" } },
        update: { data: JSON.stringify({ accessToken: cred.accessToken }) },
        create: {
          userId: cred.userId,
          provider: "airtable",
          data: JSON.stringify({ accessToken: cred.accessToken }),
        },
      }),
    ]);

    log(`  User ${cred.userId}: migrated ✓`);
    migrated++;
  }

  log(`Airtable: ${migrated} migrated, ${skipped} skipped.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log("Starting credential migration...");
  log("This script is safe to run multiple times (uses upsert).\n");

  try {
    await migrateJira();
    console.log();
    await migrateNotion();
    console.log();
    await migrateAirtable();
    console.log();
    log("Migration complete.");
    log("Next step: verify data in the Credential table, then you can drop");
    log("NotionCredential and AirtableCredential tables in a future migration.");
  } catch (err) {
    console.error("[migrate-credentials] ERROR:", err);
    process.exit(1);
  } finally {
    await base.$disconnect();
  }
}

main();
