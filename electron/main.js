const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const dotenv = require("dotenv");

const APP_PORT = 3000;
const APP_HOST = "127.0.0.1";
const APP_URL = `http://${APP_HOST}:${APP_PORT}`;

let mainWindow = null;
let webProcess = null;
let isBootstrapping = false;
let isStartingServer = false;
let appIsQuitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function log(...args) {
  try {
    console.log("[olly-startup]", ...args);
  } catch {}
}

function logError(...args) {
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

function getNextBin() {
  return path.join(getRepoRoot(), "node_modules", "next", "dist", "bin", "next");
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
      log("Loaded env from:", envPath);
      return;
    }
  }

  log("No .env.local found in expected locations");
}

function isProcessRunning(proc) {
  return !!proc && proc.exitCode === null && !proc.killed;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function cleanupWebProcess() {
  if (webProcess) {
    try {
      webProcess.removeAllListeners();
      if (webProcess.stdout) webProcess.stdout.removeAllListeners();
      if (webProcess.stderr) webProcess.stderr.removeAllListeners();
    } catch {}

    if (isProcessRunning(webProcess)) {
      try {
        webProcess.kill("SIGTERM");
      } catch {}
    }
  }

  webProcess = null;
  isStartingServer = false;
}

function attachChildLogging(child) {
  if (child.stdout) {
    child.stdout.on("data", (data) => {
      try {
        const text = data.toString().trim();
        if (text) log("[next]", text);
      } catch {}
    });

    child.stdout.on("error", (err) => {
      logError("stdout stream error:", err.message || err);
    });
  }

  if (child.stderr) {
    child.stderr.on("data", (data) => {
      try {
        const text = data.toString().trim();
        if (text) logError("[next]", text);
      } catch {}
    });

    child.stderr.on("error", (err) => {
      logError("stderr stream error:", err.message || err);
    });
  }
}

function startWebServer() {
  if (isStartingServer || isProcessRunning(webProcess)) {
    log("Web server already starting or running; skipping duplicate spawn.");
    return;
  }

  const webDir = getWebDir();
  const nextBin = getNextBin();

  if (!fs.existsSync(nextBin)) {
    throw new Error(`Next binary not found: ${nextBin}`);
  }

  if (!fs.existsSync(webDir)) {
    throw new Error(`Web directory not found: ${webDir}`);
  }

  const nextArgs = app.isPackaged
    ? [nextBin, "start", "-p", String(APP_PORT), "-H", APP_HOST]
    : [nextBin, "dev", "-p", String(APP_PORT), "-H", APP_HOST];

  log("app.isPackaged =", app.isPackaged);
  log("Starting web server from:", webDir);
  log("Using Next binary:", nextBin);
  log("Using args:", nextArgs.join(" "));

  isStartingServer = true;

  const child = spawn(process.execPath, nextArgs, {
    cwd: webDir,
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      HOSTNAME: APP_HOST,
      NODE_ENV: app.isPackaged ? "production" : "development",
      NEXTAUTH_URL: APP_URL,
      AUTH_TRUST_HOST: "true",
      BROWSER: "none"
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });

  webProcess = child;
  attachChildLogging(child);

  child.once("spawn", () => {
    isStartingServer = false;
    log("Web process spawned with pid:", child.pid);
  });

  child.once("error", (err) => {
    isStartingServer = false;
    logError("Web process error:", err);
    showFatalError(err);
  });

  child.once("exit", (code, signal) => {
    log("Web process exited:", { code, signal });
    cleanupWebProcess();

    if (!appIsQuitting) {
      logError("Web process exited before app shutdown.");
    }
  });
}

function waitForServer(url, timeoutMs = 120000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (!isProcessRunning(webProcess)) {
        reject(new Error("Local web server exited before becoming ready."));
        return;
      }

      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });

      req.on("error", () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Server did not start in time: ${url}`));
          return;
        }

        setTimeout(attempt, 1000);
      });

      req.setTimeout(3000, () => {
        req.destroy();
      });
    };

    attempt();
  });
}

async function bootstrap() {
  if (isBootstrapping) {
    log("Bootstrap already in progress; skipping duplicate call.");
    return;
  }

  isBootstrapping = true;

  try {
    loadEnv();
    createWindow();
    startWebServer();
    await wait(1500);
    await waitForServer(APP_URL, 120000);

    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    }

    await mainWindow.loadURL(APP_URL);
  } catch (err) {
    showFatalError(err);
  } finally {
    isBootstrapping = false;
  }
}

app.whenReady().then(bootstrap);

app.on("before-quit", () => {
  appIsQuitting = true;
  cleanupWebProcess();
});

app.on("window-all-closed", () => {
  cleanupWebProcess();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && !isBootstrapping) {
    bootstrap();
  }
});