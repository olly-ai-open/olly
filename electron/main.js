const { app, BrowserWindow } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')

let win
let serverProcess

// 1. STOP THE INFINITE LOOP: Only allow one instance of the app
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

function startServer() {
  const isPackaged = app.isPackaged
  const baseDir = isPackaged 
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..')
    
  const nextBin = path.join(baseDir, 'node_modules/next/dist/bin/next')
  const webDir = path.join(baseDir, 'apps/web')

  // Use the system 'node' to avoid spawning another Electron instance
  serverProcess = spawn('node', [nextBin, 'start', '-p', '3000'], {
    cwd: webDir,
    env: { 
      ...process.env, 
      NODE_ENV: 'production',
      PORT: '3000'
    },
    shell: true
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Olly',
    show: true,
    backgroundColor: '#0f172a'
  })

  // Show a loading screen
  win.loadURL('data:text/html,<html><body style="background:#0f172a;color:white;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><div><h1>Starting Olly...</h1><p>Setting up your local environment.</p></div></body></html>')

  const poll = () => {
    http.get('http://localhost:3000', (res) => {
      win.loadURL('http://localhost:3000')
    }).on('error', () => {
      setTimeout(poll, 1000)
    })
  }
  poll()
}

app.whenReady().then(() => {
  if (gotTheLock) {
    startServer()
    createWindow()
  }
})

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill()
  app.quit()
})

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill()
})