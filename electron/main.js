const { app, BrowserWindow } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')

let win
let server

// This creates a log file on the user's Desktop so we can see any errors
const logPath = path.join(app.getPath('desktop'), 'olly-debug-log.txt')
function log(msg) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} - ${msg}\n`)
}

function startServer() {
  const isPackaged = app.isPackaged
  const baseDir = isPackaged 
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..')
    
  const nextBin = path.join(baseDir, 'node_modules/next/dist/bin/next')
  const webDir = path.join(baseDir, 'apps/web')

  log(`Starting server. Base: ${baseDir}, WebDir: ${webDir}`)

  server = spawn(process.execPath, [nextBin, 'start', '-p', '3000'], {
    cwd: webDir,
    env: { ...process.env, NODE_ENV: 'production' },
    shell: false
  })

  server.stdout.on('data', (d) => log(`[INFO] ${d}`))
  server.stderr.on('data', (d) => log(`[ERROR] ${d}`))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Olly',
    show: true, 
  })

  // Loading screen
  win.loadURL('data:text/html,<html><body style="background:#0f172a;color:white;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><h1>Starting Olly...</h1><p>This takes 10-20 seconds on first launch.</p></body></html>')

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
  startServer()
  createWindow()
})

app.on('window-all-closed', () => {
  if (server) server.kill()
  app.quit()
})