import { app, BrowserWindow, dialog } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import dotenv from 'dotenv';

let mainWindow: BrowserWindow | null = null;
let webProcess: ChildProcess | null = null;

const APP_PORT = Number(process.env.PORT || 3000);
const APP_URL = `http://localhost:${APP_PORT}`;
const HEALTH_URL = `${APP_URL}/api/health`;
const STARTUP_TIMEOUT_MS = 90_000;

function log(message: string, extra?: unknown) {
  const prefix = `[desktop-startup] ${message}`;
  if (extra !== undefined) {
    console.log(prefix, extra);
  } else {
    console.log(prefix);
  }
}

function getRepoRoot() {
  return process.cwd();
}

function getWebDir() {
  return path.join(getRepoRoot(), 'apps', 'web');
}

function getEnvFilePath() {
  return path.join(getWebDir(), '.env.local');
}

function loadWebEnv() {
  const envPath = getEnvFilePath();
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    log('Loaded env file', envPath);
  } else {
    log('Env file not found', envPath);
  }
}

function validateRequiredEnv() {
  const required = [
    'DATABASE_URL',
    'PRISMA_FIELD_ENCRYPTION_KEY',
    'AUTH_SECRET',
    'NEXTAUTH_URL',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function parseDatabaseTarget(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname || '127.0.0.1',
    port: Number(url.port || 5432),
  };
}

function checkTcpPort(host: string, port: number, timeoutMs = 1500) {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();

    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function ensureDatabaseReachable() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  const { host, port } = parseDatabaseTarget(databaseUrl);
  const reachable = await checkTcpPort(host, port);

  if (!reachable) {
    throw new Error(`PostgreSQL is not reachable at ${host}:${port}. Start local PostgreSQL first.`);
  }

  log('Database reachable', { host, port });
}

function runCommand(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    log(`Running command: ${command} ${args.join(' ')}`, { cwd });

    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        PORT: String(APP_PORT),
        NEXTAUTH_URL: APP_URL,
      },
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });

    let stderr = '';

    child.stdout?.on('data', (data) => {
      log(data.toString());
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      log(text);
    });

    child.on('error', (err) => reject(err));

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with code ${code}\n${stderr}`));
      }
    });
  });
}

async function runPrismaPreflight() {
  const webDir = getWebDir();
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  await runCommand(npxCmd, ['prisma', 'generate'], webDir);

  if (process.env.OLLY_PRISMA_DB_PUSH === 'true') {
    await runCommand(npxCmd, ['prisma', 'db', 'push'], webDir);
  } else {
    await runCommand(npxCmd, ['prisma', 'migrate', 'deploy'], webDir);
  }
}

function isHttpReady(url: string) {
  return new Promise<boolean>((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 500));
    });

    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServerReady(url: string, timeoutMs: number) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const ready = await isHttpReady(url);
    if (ready) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

function spawnWebServer() {
  const webDir = getWebDir();
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  log('Starting Next.js from apps/web', { webDir });

  webProcess = spawn(npxCmd, ['next', 'dev', '-p', String(APP_PORT)], {
    cwd: webDir,
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      NEXTAUTH_URL: APP_URL,
    },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  webProcess.stdout?.on('data', (data) => {
    log(`web stdout: ${data.toString()}`);
  });

  webProcess.stderr?.on('data', (data) => {
    log(`web stderr: ${data.toString()}`);
  });

  webProcess.on('error', (err) => {
    log('Web process error', err);
  });

  webProcess.on('exit', (code, signal) => {
    log('Web process exited', { code, signal });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    show: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
}

function showLoadingScreen() {
  if (!mainWindow) return;

  const html = `
    <html>
      <body style="margin:0;background:#0f172a;color:#fff;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
        <div style="max-width:560px;text-align:center;padding:24px;">
          <h1 style="margin:0 0 12px;font-size:28px;">Starting Olly</h1>
          <p style="margin:0;opacity:.85;line-height:1.6;">
            Checking environment, database, Prisma, and local web server...
          </p>
        </div>
      </body>
    </html>
  `;

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function showErrorScreen(title: string, message: string) {
  if (!mainWindow) {
    dialog.showErrorBox(title, message);
    return;
  }

  const html = `
    <html>
      <body style="margin:0;background:#111827;color:#fff;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;padding:24px;">
        <div style="max-width:800px;">
          <h1 style="margin:0 0 16px;font-size:28px;">${title}</h1>
          <pre style="white-space:pre-wrap;background:#1f2937;padding:16px;border-radius:12px;line-height:1.5;font-size:13px;">${message}</pre>
        </div>
      </body>
    </html>
  `;

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function bootstrap() {
  try {
    createWindow();
    showLoadingScreen();

    loadWebEnv();
    validateRequiredEnv();
    await ensureDatabaseReachable();
    await runPrismaPreflight();

    spawnWebServer();

    const ready = await waitForServerReady(HEALTH_URL, STARTUP_TIMEOUT_MS);
    if (!ready) {
      throw new Error(`Web server did not become ready at ${HEALTH_URL} within ${STARTUP_TIMEOUT_MS / 1000} seconds.`);
    }

    await mainWindow?.loadURL(APP_URL);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    log('Startup failed', message);
    showErrorScreen('Olly failed to start', message);
  }
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (webProcess && !webProcess.killed) {
    webProcess.kill();
  }
});