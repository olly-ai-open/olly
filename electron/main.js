const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const dotenv = require("dotenv");

const APP_PORT = 3000;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

let mainWindow = null;
let webProcess = null;
let isStartingServer = false;
let serverExitedEarly = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function safeLog(...args) {
  try {
    console.log("[olly-startup]", ...args);
  } catch {}
}

function safeError(...args) {
  try {
    console.error("[olly-startup]", ...args);
  } catch {}
}

function getRepoRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, "..");
}

function getWebDir() {
  return path.join(getRepoRoot(), "apps", "web");
}

function loadEnv() {
  const possibleEnvPaths = [
    path.join(getWebDir(), ".env.local"),
    path.join(process.resourcesPath || "", "apps", "web", ".env.local"),
    path.join(path.dirname(app.getPath("exe")), ".env.local")
  ];

  for (const envPath of possibleEnvPaths) {
    if (envPath && fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      safeLog("Loaded env from:", envPath);
      return;
    }
  }

  safeLog("No .env.local found in expected locations");
}

function isProcessAlive(proc) {
  return !!proc && !proc.killed && proc.exitCode === null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForServer(url, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;

    const tryConnect = () => {
      if (settled) return;

      if (serverExitedEarly) {
        settled = true;
        reject(new Error("Local web server exited before startup completed."));
        return;
      }

      if (!isProcessAlive(webProcess)) {
        settled = true;
        reject(new Error("Local web server is not running."));
        return;
      }

      const req = http.get(url, (res) => {
        res.resume();
        settled = true;
        resolve(true);
      });

      req.on("error", () => {
        if (Date.now() - startedAt >= timeoutMs) {
          settled = true;
          reject(new Error(`Server did not start in time: ${url}`));
          return;
        }
        setTimeout(tryConnect, 1000);
      });

      req.setTimeout(3000, () => {
        req.destroy();
      });
    };

    tryConnect();
  });
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#08142b",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function showFatalError(err) {
  const message = err && err.stack ? err.stack : String(err);

  if (mainWindow && !mainWindow.isDestroyed()) {
    const html = `
      <html>
        <body style="margin:0;background:#08142b;color:white;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
          <div style="max-width:840px;padding:24px;">
            <h1>Olly failed to start</h1>
            <pre style="white-space:pre-wrap;background:#1e293b;padding:16px;border-radius:12px;">${message}</pre>
          </div>
        </body>
      </html>
    `;
    mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    mainWindow.show();
  } else {
    dialog.showErrorBox("Olly failed to start", message);
  }
}

function killWebProcess() {
  if (webProcess && isProcessAlive(webProcess)) {
    try {
      webProcess.kill("SIGTERM");
    } catch {}
  }
  webProcess = null;
}

function startWebServer() {
  if (isStartingServer || isProcessAlive(webProcess)) {
    safeLog("Web server already starting/running, skipping duplicate spawn.");
    return;
  }

  isStartingServer = true;
  serverExitedEarly = false;

  const repoRoot = getRepoRoot();
  const webDir = getWebDir();

  const nextBin = path.join(repoRoot, "node_modules", "next", "dist", "bin", "next");
  const nextArgs = app.isPackaged
    ? [nextBin, "start", "-p", String(APP_PORT), "-H", "127.0.0.1"]
    : [nextBin, "dev", "-p", String(APP_PORT), "-H", "127.0.0.1"];

  safeLog("app.isPackaged =", app.isPackaged);
  safeLog("Starting web server from:", webDir);
  safeLog("Using Next binary:", nextBin);
  safeLog("Using args:", nextArgs.join(" "));

  if (!fs.existsSync(nextBin)) {
    isStartingServer = false;
    throw new Error(`Next binary not found: ${nextBin}`);
  }

  webProcess = spawn(process.execPath, nextArgs, {
    cwd: webDir,
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: app.isPackaged ? "production" : "development",
      NEXTAUTH_URL: APP_URL,
      AUTH_TRUST_HOST: "true"
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });

  const pipeOutput = (stream, prefix, writer) => {
    if (!stream) return;
    stream.on("data", (data) => {
      try {
        writer(`${prefix} ${data.toString()}`);
      } catch {}
    });
    stream.on("error", () => {});
  };

  pipeOutput(webProcess.stdout, "[next]", (msg) => safeLog(msg));
  pipeOutput(webProcess.stderr, "[next]", (msg) => safeError(msg));

  webProcess.once("spawn", () => {
    safeLog("Web process spawned with pid:", webProcess.pid);
    isStartingServer = false;
  });

  webProcess.once("error", (err) => {
    isStartingServer = false;
    serverExitedEarly = true;
    safeError("Web process error:", err);
    showFatalError(err);
  });

  webProcess.once("exit", (code, signal) => {
    isStartingServer = false;
    serverExitedEarly = true;
    safeLog("Web process exited:", { code, signal });

    if (!app.isQuitting) {
      safeError("Web server exited before app finished running.");
    }
  });
}

async function bootstrap() {
  try {
    createWindow();
    loadEnv();
    startWebServer();
    await wait(1500);
    await waitForServer(APP_URL, 120000);

    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    }

    await mainWindow.loadURL(APP_URL);
  } catch (err) {
    showFatalError(err);
  }
}

app.whenReady().then(bootstrap);

app.on("before-quit", () => {
  app.isQuitting = true;
  killWebProcess();
});

app.on("window-all-closed", () => {
  killWebProcess();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    bootstrap();
  }
});