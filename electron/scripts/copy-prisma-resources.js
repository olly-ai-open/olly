#!/usr/bin/env node
/**
 * Ensure Prisma engine binaries (per `binaryTargets` in schema.prisma)
 * are present inside the Next.js standalone output.
 *
 * Next standalone tracing may include only the build host's native
 * engine, but the packaged Mac DMG must run on both Intel (x64) and
 * Apple Silicon (arm64). This script defensively copies the full
 * `.prisma/client/` folder so all targeted engines ship with the app.
 */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const standalone = path.join(repoRoot, "apps", "web", ".next", "standalone");

const sources = [
  {
    label: ".prisma/client (apps/web)",
    src: path.join(
      repoRoot,
      "apps",
      "web",
      "node_modules",
      ".prisma",
      "client",
    ),
    dest: path.join(
      standalone,
      "apps",
      "web",
      "node_modules",
      ".prisma",
      "client",
    ),
  },
  {
    label: ".prisma/client (root, hoisted)",
    src: path.join(repoRoot, "node_modules", ".prisma", "client"),
    dest: path.join(standalone, "node_modules", ".prisma", "client"),
  },
];

if (!fs.existsSync(standalone)) {
  console.error(
    `[copy-prisma-resources] standalone not found at ${standalone}; run "npm run build:web" first.`,
  );
  process.exit(1);
}

let copied = 0;
for (const { label, src, dest } of sources) {
  if (!fs.existsSync(src)) {
    console.log(
      `[copy-prisma-resources] skip ${label}: source missing (${src})`,
    );
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(
    `[copy-prisma-resources] copied ${label}: ${src} -> ${dest}`,
  );
  copied++;
}

if (copied === 0) {
  console.error(
    "[copy-prisma-resources] no Prisma client found to copy. Did you run prisma generate?",
  );
  process.exit(1);
}
