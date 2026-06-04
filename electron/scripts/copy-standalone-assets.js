#!/usr/bin/env node
/**
 * Copy Next.js static assets into the standalone output folder so the
 * packaged Electron app can serve them.
 *
 * Next's `output: "standalone"` deliberately omits `.next/static/` and
 * `public/` from the standalone tree. Without this step, the production
 * server returns 404s for `/_next/static/*` and `/public/*`, leaving the
 * UI rendered without CSS or images.
 *
 * Reference: https://nextjs.org/docs/app/api-reference/next-config-js/output
 */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const webDir = path.join(repoRoot, "apps", "web");
const standaloneDir = path.join(webDir, ".next", "standalone");

const copies = [
  {
    label: "static",
    src: path.join(webDir, ".next", "static"),
    dest: path.join(standaloneDir, "apps", "web", ".next", "static"),
  },
  {
    label: "public",
    src: path.join(webDir, "public"),
    dest: path.join(standaloneDir, "apps", "web", "public"),
  },
];

function copyDir({ label, src, dest }) {
  if (!fs.existsSync(src)) {
    console.warn(
      `[copy-standalone-assets] Source missing, skipping ${label}: ${src}`,
    );
    return;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[copy-standalone-assets] ${label}: ${src} -> ${dest}`);
}

if (!fs.existsSync(standaloneDir)) {
  console.error(
    `[copy-standalone-assets] Standalone build not found at ${standaloneDir}. Run "npm run build:web" first.`,
  );
  process.exit(1);
}

for (const entry of copies) {
  copyDir(entry);
}
