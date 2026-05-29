const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn } = require("child_process");

let mainWindow = null;
let webServer = null;

const FALLBACK_AUTH_SECRET = "olly-desktop-local-secret-change-this";

function getRepoRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }
  return path.resolve(__dirname, "..");
}

function getStandaloneDir() {
  return path.join(getRepoRoot(), "apps", "web", ".next", "standalone");
}

function getStandaloneServerPath() {
  return path.join(getStandaloneDir(), "apps", "web", "server.js");
}

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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;

      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error("Failed to get a free port."));
        }
      });
    });

    server.on("error", reject);
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (webServer && webServer.exitCode !== null) {
        return reject(new Error("Local web server exited before becoming ready."));
      }

      const ready = await isPortOpen(port);

      if (ready) {
        return resolve();
      }

      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error(`Timed out waiting for local web server on port ${port}`));
      }

      setTimeout(attempt, 500);
    };

    attempt();
  });
}

function startWebServer(port) {
  const standaloneDir = getStandaloneDir();
  const serverPath = getStandaloneServerPath();

  const authSecret =
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    FALLBACK_AUTH_SECRET;

  console.log("[olly-startup] app.isPackaged =", app.isPackaged);
  console.log("[olly-startup] Standalone dir =", standaloneDir);
  console.log("[olly-startup] Server path =", serverPath);
  console.log("[olly-startup] Exec path =", process.execPath);
  console.log("[olly-startup] Selected port =", port);
  console.log("[olly-startup] Auth secret configured =", Boolean(authSecret));

  if (!fs.existsSync(standaloneDir)) {
    throw new Error(`Standalone directory not found: ${standaloneDir}`);
  }

  if (!fs.existsSync(serverPath)) {
    throw new Error(`Standalone server.js not found: ${serverPath}`);
  }

  webServer = spawn(process.execPath, [serverPath], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      AUTH_SECRET: authSecret,
      NEXTAUTH_SECRET: authSecret,
      NEXTAUTH_URL: `http://127.0.0.1:${port}`,
      AUTH_URL: `http://127.0.0.1:${port}`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  console.log("[olly-startup] Web process spawned with pid:", webServer.pid);

  webServer.stdout.on("data", (data) => {
    console.log(`[web stdout] ${data.toString()}`);
  });

  webServer.stderr.on("data", (data) => {
    console.error(`[web stderr] ${data.toString()}`);
  });

  webServer.on("exit", (code, signal) => {
    console.error("[olly-startup] Web process exited:", { code, signal });
  });

  webServer.on("error", (err) => {
    console.error("[olly-startup] Failed to start web process:", err);
  });
}

function stopWebServer() {
  if (webServer && webServer.exitCode === null) {
    webServer.kill();
  }
  webServer = null;
}

async function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function bootstrap() {
  const port = await getFreePort();
  startWebServer(port);
  await waitForServer(port);
  await createMainWindow(port);
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
  } catch (error) {
    console.error(error);
    app.quit();
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        const port = await getFreePort();
        startWebServer(port);
        await waitForServer(port);
        await createMainWindow(port);
      } catch (error) {
        console.error(error);
      }
    }
  });
});

app.on("window-all-closed", () => {
  stopWebServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopWebServer();
});