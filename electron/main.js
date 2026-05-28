const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const dotenv = require("dotenv");

let mainWindow = null;
let webProcess = null;

const APP_PORT = 3000;
const APP_URL = `http://localhost:${APP_PORT}`;

function log(...args) {
  console.log("[olly-startup]", ...args);
}

function getRepoRoot() {
  return path.resolve(__dirname, "..");
}

function getWebDir() {
  return path.join(getRepoRoot(), "apps", "web");
}

function loadEnv() {
  const envPath = path.join(getWebDir(), ".env.local");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    log("Loaded env from:", envPath);
  } else {
    log("No .env.local found at:", envPath);
  }
}

function waitForServer(url, retries = 90) {
  return new Promise((resolve, reject) => {
    const tryConnect = (remaining) => {
      http
        .get(url, (res) => {
          res.resume();
          resolve(true);
        })
        .on("error", () => {
          if (remaining <= 0) {
            reject(new Error(`Server did not start in time: ${url}`));
          } else {
            setTimeout(() => tryConnect(remaining - 1), 1000);
          }
        });
    };
    tryConnect(retries);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#08142b",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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
  } else {
    dialog.showErrorBox("Olly failed to start", message);
  }
}

function startWebServer() {
  const webDir = getWebDir();
  const nextBin = path.join(getRepoRoot(), "node_modules", "next", "dist", "bin", "next");

  log("Starting web server from:", webDir);
  log("Using Next binary:", nextBin);

  webProcess = spawn(process.execPath, [nextBin, "dev", "-p", String(APP_PORT)], {
    cwd: webDir,
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      NEXTAUTH_URL: APP_URL,
      AUTH_TRUST_HOST: "true"
    },
    stdio: "pipe",
    shell: false
  });

  webProcess.stdout.on("data", (data) => {
    console.log("[next]", data.toString());
  });

  webProcess.stderr.on("data", (data) => {
    console.error("[next]", data.toString());
  });

  webProcess.on("error", (err) => {
    console.error("[olly-startup] web process error:", err);
    showFatalError(err);
  });

  webProcess.on("exit", (code, signal) => {
    console.log("[olly-startup] web process exited:", { code, signal });
  });
}

async function bootstrap() {
  try {
    loadEnv();
    createWindow();
    startWebServer();
    await waitForServer(APP_URL, 90);
    await mainWindow.loadURL(APP_URL);
  } catch (err) {
    showFatalError(err);
  }
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  if (webProcess && !webProcess.killed) {
    webProcess.kill();
  }
  app.quit();
});