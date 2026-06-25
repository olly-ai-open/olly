/**
 * Window helpers for the desktop app: main window, loading screen,
 * and an error screen with a copyable stack trace. Kept simple so
 * we don't need a separate UI framework before the Next server is up.
 */

const path = require("node:path");
const { BrowserWindow, dialog, shell } = require("electron");

// The app itself is served from localhost; everything else is "external".
function isInternalUrl(url) {
  return (
    url.startsWith("http://localhost:3000") ||
    url.startsWith("http://127.0.0.1:3000")
  );
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: true,
    backgroundColor: "#0f172a",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "..", "preload.js"),
    },
  });

  // Open external links (e.g. the Notion integration setup, which only renders
  // its Save button in a real browser) in the user's default browser instead
  // of a bare Electron window. We only intercept window.open / target="_blank";
  // in-window navigations (used by Google OAuth sign-in) are left untouched.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !isInternalUrl(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  return win;
}

function htmlPage(title, body) {
  const safeTitle = String(title).replace(/</g, "&lt;");
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <html>
      <body style="margin:0;background:#0f172a;color:#fff;font-family:-apple-system,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;padding:24px;">
        <div style="max-width:760px;text-align:center;">
          <h1 style="margin:0 0 16px;font-size:28px;">${safeTitle}</h1>
          ${body}
        </div>
      </body>
    </html>
  `)}`;
}

function showLoading(window, message) {
  if (!window) return;
  const msg = String(message).replace(/</g, "&lt;");
  window.loadURL(
    htmlPage(
      "Starting Olly",
      `<p style="margin:0;opacity:.85;line-height:1.6;font-size:15px;">${msg}</p>`,
    ),
  );
}

function showError(window, title, message) {
  const text = String(message).replace(/</g, "&lt;");
  if (!window) {
    dialog.showErrorBox(title, message);
    return;
  }
  window.loadURL(
    htmlPage(
      title,
      `<pre style="white-space:pre-wrap;background:#1f2937;padding:16px;border-radius:12px;line-height:1.5;font-size:13px;text-align:left;max-height:60vh;overflow:auto;">${text}</pre>`,
    ),
  );
}

module.exports = { createMainWindow, showLoading, showError };
