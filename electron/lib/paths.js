/**
 * Centralized path helpers for the Electron desktop app.
 *
 * Distinguishes packaged vs unpackaged layouts:
 * - In dev (`npm run electron`), resources live in the repo.
 * - In a packaged build, files come from `process.resourcesPath`.
 */

const path = require("node:path");
const { app } = require("electron");

function getRepoRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }
  return path.resolve(__dirname, "..", "..");
}

function getWebDir() {
  return path.join(getRepoRoot(), "apps", "web");
}

function getStandaloneDir() {
  return path.join(getWebDir(), ".next", "standalone");
}

function getStandaloneServerPath() {
  return path.join(getStandaloneDir(), "apps", "web", "server.js");
}

function getUserDataDir() {
  return app.getPath("userData");
}

function getPostgresDataDir() {
  return path.join(getUserDataDir(), "postgres-data");
}

function getStateFilePath() {
  return path.join(getUserDataDir(), "state.json");
}

function getMigrationsDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "prisma", "migrations");
  }
  return path.join(getWebDir(), "prisma", "migrations");
}

function getPackagedEnvPath() {
  return path.join(process.resourcesPath, "env", ".env.local");
}

function getDevEnvPath() {
  return path.join(getWebDir(), ".env.local");
}

module.exports = {
  getRepoRoot,
  getWebDir,
  getStandaloneDir,
  getStandaloneServerPath,
  getUserDataDir,
  getPostgresDataDir,
  getStateFilePath,
  getMigrationsDir,
  getPackagedEnvPath,
  getDevEnvPath,
};
