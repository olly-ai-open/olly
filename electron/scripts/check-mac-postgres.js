#!/usr/bin/env node
/**
 * Fail a Mac build early if either embedded Postgres architecture package is
 * missing from node_modules.
 *
 * `npm install` only installs the optional package for the machine it runs on.
 * A DMG built without the other one starts fine on the build machine's
 * architecture and fails on the other with "Cannot find package
 * '@embedded-postgres/darwin-x64'". npm treats a platform-mismatched optional
 * dependency as satisfied, so the plain install command reports "up to date"
 * and does nothing; the --os and --cpu overrides below are required.
 */
const fs = require("node:fs");
const path = require("node:path");

const VERSION = "17.9.0-beta.17";
const root = path.resolve(__dirname, "..", "..");
const missing = ["darwin-x64", "darwin-arm64"].filter(
  (arch) =>
    !fs.existsSync(
      path.join(root, "node_modules", "@embedded-postgres", arch, "package.json"),
    ),
);

if (missing.length === 0) {
  console.log("[check-mac-postgres] OK — embedded Postgres present for x64 and arm64.");
  process.exit(0);
}

console.error(
  `[check-mac-postgres] Missing embedded Postgres for: ${missing.join(", ")}.\n` +
    "The DMG for that architecture would fail to start. Install with:\n" +
    missing
      .map(
        (arch) =>
          `  npm install --no-save --force --os darwin --cpu ${arch.replace("darwin-", "")} @embedded-postgres/${arch}@${VERSION}`,
      )
      .join("\n"),
);
process.exit(1);
