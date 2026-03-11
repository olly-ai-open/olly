#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = path.resolve(process.cwd())
const target = path.join(root, '.next', 'types', 'routes.d.ts')

async function exists(p) {
  try { await fs.access(p); return true } catch { return false }
}

async function waitForFile(file, timeoutMs = 30000) {
  const start = Date.now()
  const delay = (ms) => new Promise((r) => setTimeout(r, ms))
  while (!(await exists(file))) {
    if (Date.now() - start > timeoutMs) break
    await delay(500)
  }
}

await waitForFile(target, 30000)

const proc = spawn('npm', ['run', 'typecheck:watch'], { stdio: 'inherit', shell: true })
proc.on('exit', (code) => process.exit(code ?? 0))
