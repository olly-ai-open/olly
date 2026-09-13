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
  // Generated once per install. Never rotate these automatically: the
  // encryption key protects OAuth tokens already stored in the local
  // database, and changing it makes them unreadable.
  authSecret: null,
  fieldEncryptionKey: null,
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

function generateAuthSecret() {
  return crypto.randomBytes(32).toString("base64");
}

/**
 * Key format expected by prisma-field-encryption (@47ng/cloak):
 * "k1.aesgcm256." followed by 32 random bytes in base64url.
 */
function generateFieldEncryptionKey() {
  return `k1.aesgcm256.${crypto.randomBytes(32).toString("base64url")}`;
}

/**
 * Return the per-install secrets, generating and persisting any that are
 * missing. Called once at startup before the web server is spawned.
 */
function ensureInstallSecrets() {
  const state = loadState();
  let changed = false;
  if (!state.authSecret) {
    state.authSecret = generateAuthSecret();
    changed = true;
  }
  if (!state.fieldEncryptionKey) {
    state.fieldEncryptionKey = generateFieldEncryptionKey();
    changed = true;
  }
  if (changed) saveState(state);
  return {
    authSecret: state.authSecret,
    fieldEncryptionKey: state.fieldEncryptionKey,
  };
}

module.exports = {
  loadState,
  saveState,
  generatePassword,
  ensureInstallSecrets,
};
