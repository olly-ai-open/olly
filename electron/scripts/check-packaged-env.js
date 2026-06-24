#!/usr/bin/env node
/**
 * Safety net: after `build:packaged-env` generates `apps/web/.env.packaged.local`
 * (the file electron-builder bundles as `env/.env.local`), make sure it does not
 * contain LLM API keys.
 *
 * Bundling an LLM key (a) ships a live secret in plaintext inside the installer
 * and (b) suppresses the first-run /setup flow — the app treats setup as
 * complete whenever an LLM key is present in the environment.
 *
 * Rather than hard-failing (unfriendly for a team), this WARNS and asks the
 * person running the build whether to continue:
 *
 *   - No LLM keys found              -> prints OK, exits 0.
 *   - Keys found + interactive TTY   -> warns, prompts "Continue? [y/N]".
 *       y / yes -> continue (exit 0); anything else -> abort (exit 1).
 *   - Keys found + non-interactive   -> warns and CONTINUES (exit 0) so
 *       automated/CI builds aren't blocked, UNLESS OLLY_STRICT_ENV_CHECK=1,
 *       in which case it aborts (exit 1).
 *   - OLLY_ALLOW_BUNDLED_LLM_KEYS=1  -> acknowledge and skip the prompt.
 */

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const repoRoot = path.resolve(__dirname, "..", "..");
const packagedEnv = path.join(repoRoot, "apps", "web", ".env.packaged.local");

// LLM API keys: these both leak a secret AND suppress the /setup gate.
const LLM_KEY_NAMES = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"];

function keyOfLine(line) {
  // Match `KEY=...` or commented `#KEY=...` (with optional surrounding space).
  const m = line.match(/^\s*#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return m ? m[1] : null;
}

function findLlmKeyLines(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const key = keyOfLine(rawLine);
    if (key && LLM_KEY_NAMES.includes(key)) {
      hits.push({ line: i + 1, key, commented: /^\s*#/.test(rawLine) });
    }
  });
  return hits;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  if (!fs.existsSync(packagedEnv)) {
    console.warn(
      `[check-packaged-env] ${packagedEnv} not found — run "npm run build:packaged-env" first. Skipping check.`,
    );
    return;
  }

  const hits = findLlmKeyLines(fs.readFileSync(packagedEnv, "utf8"));

  if (hits.length === 0) {
    console.log("[check-packaged-env] OK — no LLM API keys in the bundled env.");
    return;
  }

  console.warn("");
  console.warn(
    "⚠️  [check-packaged-env] LLM API key(s) found in the env that will be bundled:",
  );
  console.warn(`    file: ${packagedEnv}`);
  for (const h of hits) {
    console.warn(
      `    line ${h.line}: ${h.key}${
        h.commented ? "  (commented — still embeds the secret)" : ""
      }`,
    );
  }
  console.warn("");
  console.warn(
    "    Shipping this installer will (1) embed a live API key in plaintext and",
  );
  console.warn(
    "    (2) skip the first-run setup screen (the app sees a key and assumes setup",
  );
  console.warn(
    "    is done). Fine for your own testing — NOT fine for an installer you share.",
  );
  console.warn("");

  if (process.env.OLLY_ALLOW_BUNDLED_LLM_KEYS === "1") {
    console.warn(
      "[check-packaged-env] OLLY_ALLOW_BUNDLED_LLM_KEYS=1 set — continuing without prompt.",
    );
    return;
  }

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (!interactive) {
    if (process.env.OLLY_STRICT_ENV_CHECK === "1") {
      console.error(
        "[check-packaged-env] Non-interactive shell + OLLY_STRICT_ENV_CHECK=1 — aborting build.",
      );
      process.exit(1);
    }
    console.warn(
      "[check-packaged-env] Non-interactive shell — continuing without a prompt.",
    );
    console.warn(
      "    (Set OLLY_STRICT_ENV_CHECK=1 to abort instead, e.g. in CI.)",
    );
    return;
  }

  const answer = await ask("Continue building anyway? [y/N] ");
  if (answer === "y" || answer === "yes") {
    console.warn("[check-packaged-env] Continuing at your request.");
    return;
  }

  console.error("[check-packaged-env] Aborted — no installer was built.");
  process.exit(1);
}

main().catch((err) => {
  console.error("[check-packaged-env] Unexpected error:", err);
  process.exit(1);
});
