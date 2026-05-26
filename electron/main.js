const { app, BrowserWindow } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')

let win
let server

function waitForServer(retries, callback) {
  http.get('http://localhost:3000', () => {
    callback()
  }).on('error', () => {
    if (retries > 0) {
      setTimeout(() => waitForServer(retries - 1, callback), 1000)
    } else {
      console.error('Server did not start in time')
    }
  })
}

function startServer() {
  const webDir = path.join(__dirname, '../apps/web')

  server = spawn(
    process.execPath,
    [
      path.join(__dirname, '../node_modules/next/dist/bin/next'),
      'start',
      '-p', '3000'
    ],
    {
      cwd: webDir,
      env: { ...process.env },
      shell: false
    }
  )

  server.stdout.on('data', (d) => console.log('[next]', d.toString()))
  server.stderr.on('data', (d) => console.error('[next]', d.toString()))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Olly',
    webPreferences: { nodeIntegration: false }
  })

  waitForServer(30, () => {
    win.loadURL('http://localhost:3000')
  })

  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  startServer()
  createWindow()
})

app.on('window-all-closed', () => {
  if (server) server.kill()
  app.quit()
})