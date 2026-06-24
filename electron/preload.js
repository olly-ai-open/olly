/**
 * Preload bridge for the renderer (the Next.js app loaded in the window).
 *
 * Exposes a tiny, explicit API over context-isolated IPC. Used by the
 * first-run setup screen to relaunch the app after the user saves their
 * LLM key (the running Next server only reads the key at startup, so a
 * full relaunch is required to pick it up).
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ollyDesktop", {
  isDesktop: true,
  restart: () => ipcRenderer.send("olly:restart"),
});
