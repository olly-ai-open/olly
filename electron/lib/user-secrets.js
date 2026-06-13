const fs = require("fs");
const path = require("path");
const os = require("os");

function getSecretsDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "olly");
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "olly");
  }

  return path.join(os.homedir(), ".config", "olly");
}

function getSecretsFilePath() {
  return path.join(getSecretsDir(), "secrets.env");
}

function ensureSecretsFile() {
  const dir = getSecretsDir();
  const file = getSecretsFilePath();

  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "# Olly user secrets\n", "utf8");
  }

  return file;
}

function parseEnv(text) {
  const result = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function serializeEnv(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("\n") + "\n";
}

function readUserSecrets() {
  const file = ensureSecretsFile();
  const text = fs.readFileSync(file, "utf8");
  return parseEnv(text);
}

function writeUserSecrets(updates) {
  const file = ensureSecretsFile();
  const current = readUserSecrets();
  const merged = { ...current, ...updates };

  fs.writeFileSync(file, serializeEnv(merged), "utf8");
  return file;
}

function applyUserSecretsToProcessEnv() {
  const secrets = readUserSecrets();

  for (const [key, value] of Object.entries(secrets)) {
    process.env[key] = value;
  }
}

function hasRequiredLlmEnv() {
  return Boolean(
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY
  );
}

module.exports = {
  getSecretsFilePath,
  readUserSecrets,
  writeUserSecrets,
  applyUserSecretsToProcessEnv,
  hasRequiredLlmEnv,
};