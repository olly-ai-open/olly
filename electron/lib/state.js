/**
 * Per-install desktop state stored under userData/state.json.
 *
 * This holds anything that should persist across launches but is
 * not part of the database (e.g. embedded Postgres password,
 * chosen port). The user data directory is kept stable across
 * versions so users keep their settings on upgrade.
 */

const fs = require("node:fs");
const crypto = require("node:crypto");

const { getStateFilePath, getUserDataDir } = require("./paths");

const DEFAULT_STATE = {
  postgresPort: null,
  postgresPassword: null,
};

function ensureUserDataDir() {
  fs.mkdirSync(getUserDataDir(), { recursive: true });
}

function loadState() {
  ensureUserDataDir();
  const file = getStateFilePath();
  if (!fs.existsSync(file)) {
    return { ...DEFAULT_STATE };
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch (err) {
    console.warn("[state] failed to read state.json, resetting:", err.message);
    return { ...DEFAULT_STATE };
  }
}

function saveState(state) {
  ensureUserDataDir();
  fs.writeFileSync(getStateFilePath(), JSON.stringify(state, null, 2), "utf8");
}

function generatePassword() {
  return crypto.randomBytes(24).toString("hex");
}

module.exports = { loadState, saveState, generatePassword };
