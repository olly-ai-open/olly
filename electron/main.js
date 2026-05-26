const { app, BrowserWindow, shell } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')

let win
let server

function log(msg) {
  const logPath = path.join(app.getPath('userData'), 'olly.log')
  fs.appendFileSync(logPath, `${new Date().toISOString()} - ${msg}\n`)
  console.log(msg)
}

function startServer() {
  // In packaged Mac apps, files are in Resources/app/
  const baseDir = path.join(__dirname, '..')
  const nextBin = path.join(baseDir, 'node_modules/next/dist/bin/next')
  const webDir = path.join(baseDir, 'apps/web')

  log(`Starting server from: ${webDir}`)
  log(`Next bin: ${nextBin}`)

  server = spawn(process.execPath, [nextBin, 'start', '-p', '3000'], {
    cwd: webDir,
    env: { ...process.env, NODE_ENV: 'production' },
    shell: false
  })

  server.stdout.on('data', (d) => log(`[STDOUT] ${d}`))
  server.stderr.on('data', (d) => log(`[STDERR] ${d}`))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Olly',
    show: true, // Show immediately
    webPreferences: { nodeIntegration: false }
  })

  // Show a loading state or just white until server is ready
  win.loadURL('data:text/html,<html><body style="background:#0f172a;color:white;display:flex;align-items:center;justify-content:center;font-family:sans-serif;"><h1>Starting Olly...</h1></body></html>')

  const poll = () => {
    http.get('http://localhost:3000', (res) => {
      log('Server ready, loading URL...')
      win.loadURL('http://localhost:3000')
    }).on('error', () => {
      setTimeout(poll, 1000)
    })
  }
  
  poll()

  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  startServer()
  createWindow()
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (server) server.kill()
    app.quit()
  }
})

app.on('before-quit', () => {
  if (server) server.kill()
})