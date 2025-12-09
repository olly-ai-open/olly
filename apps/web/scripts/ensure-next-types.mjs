#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd());
const routesFile = path.join(root, ".next", "types", "routes.d.ts");

async function ensureRoutesStub() {
  try {
    await fs.access(routesFile);
    return;
  } catch {}

  const dir = path.dirname(routesFile);
  await fs.mkdir(dir, { recursive: true });
  const stub = `// Auto-generated fallback for tsc when Next.js route types are not built yet.
// Next.js will overwrite this file after the first build/dev compile.
declare const __ollyNextRoutes: unknown;
export {};
`;
  await fs.writeFile(routesFile, stub, "utf8");
}

ensureRoutesStub().catch((err) => {
  console.error("Failed to create .next/types/routes.d.ts stub", err);
  process.exitCode = 1;
});
