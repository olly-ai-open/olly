const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");

let mainWindow = null;
let webServer = null;

function getRepoRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }
  return path.resolve(__dirname, "..");
}

function getWebDir() {
  return path.join(getRepoRoot(), "apps", "web");
}

function getStandaloneDir() {
  return path.join(getWebDir(), ".next", "standalone");
}

function getStandaloneServerPath() {
  return path.join(getStandaloneDir(), "server.js");
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const webDir = getWebDir();
  const standaloneDir = getStandaloneDir();
  const serverPath = getStandaloneServerPath();

  if (!fs.existsSync(webDir)) {
    throw new Error(`Web directory not found: ${webDir}`);
  }

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
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  webServer.stdout.on("data", (data) => {
    console.log(`[web stdout] ${data.toString()}`);
  });

  webServer.stderr.on("data", (data) => {
    console.error(`[web stderr] ${data.toString()}`);
  });

  webServer.on("exit", (code, signal) => {
    console.error(`Web server exited with code=${code} signal=${signal}`);
  });

  webServer.on("error", (err) => {
    console.error("Failed to start web server:", err);
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
  const port = 3000;

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
        await createMainWindow(3000);
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