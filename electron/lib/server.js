/**
 * Spawn and manage the Next.js standalone server using Electron's
 * embedded Node runtime. Replaces the inline child-process logic
 * that used to live in main.js.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");

const { getStandaloneDir, getStandaloneServerPath } = require("./paths");

function isPortOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function waitForServer(port, timeoutMs = 90000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (await isPortOpen(port)) return resolve();
      if (Date.now() - startedAt > timeoutMs) {
        return reject(
          new Error(`Timed out waiting for server on port ${port}`),
        );
      }
      setTimeout(attempt, 500);
    };
    attempt();
  });
}

function startNextServer({ port, env = {}, log = console.log }) {
  const standaloneDir = getStandaloneDir();
  const serverPath = getStandaloneServerPath();

  if (!fs.existsSync(serverPath)) {
    throw new Error(`Standalone server.js not found at ${serverPath}`);
  }

  log(`[server] spawning ${serverPath}`);
  const child = spawn(process.execPath, [serverPath], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (d) =>
    log(`[server stdout] ${d.toString().trimEnd()}`),
  );
  child.stderr.on("data", (d) =>
    log(`[server stderr] ${d.toString().trimEnd()}`),
  );
  child.on("error", (err) => log("[server] error:", err.message));
  child.on("exit", (code, signal) =>
    log("[server] exited:", { code, signal }),
  );

  return child;
}

function stopNextServer(child) {
  if (child && child.exitCode === null) {
    child.kill();
  }
}

module.exports = {
  startNextServer,
  stopNextServer,
  waitForServer,
  isPortOpen,
};
