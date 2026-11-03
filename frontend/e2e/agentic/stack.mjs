// Starts a throwaway GSSG stack for agentic e2e runs: a fresh SQLite data
// directory, a migrated backend on a free port, and the Vite dev server on the
// port the runner assigns. `e2e.config.ts` runs it as `app.command`, and the
// runner stops it when the run ends. Nothing touches `data/` or any `.env` data.
//
//   node e2e/agentic/stack.mjs <vite-port>
//
// The backend runs on GSSG_PYTHON, else the first venv found below.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = fileURLToPath(new URL('../..', import.meta.url))
const repoRoot = path.resolve(frontendDir, '..')
const vitePort = process.argv[2]
if (!vitePort) throw new Error('usage: node e2e/agentic/stack.mjs <vite-port>')

const python = [
  process.env.GSSG_PYTHON,
  path.join(repoRoot, 'venv', 'Scripts', 'python.exe'),
  path.join(repoRoot, 'venv', 'bin', 'python'),
  path.join(os.homedir(), '.venvs', 'sentinel', 'bin', 'python'),
].find((candidate) => candidate && existsSync(candidate))
if (!python) throw new Error('No backend Python found; set GSSG_PYTHON')

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'gssg-e2e-'))
const apiPort = await freePort()
const backendEnv = {
  ...process.env,
  GSSG_DATA_DIR: dataDir,
  GSSG_HOST: '127.0.0.1',
  GSSG_PORT: String(apiPort),
  GSSG_DISABLE_SCHEDULER: '1',
  GSSG_SECURE_COOKIES: '0',
  GSSG_SMS_ENABLED: '0',
  GSSG_OPENWA_ENABLED: '0',
  GSSG_BIOTIME_BASE_URL: '',
  PYTHONUNBUFFERED: '1',
}

const children = []
let stopping = false
const stop = (code) => {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
  process.exit(code)
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

const start = (name, command, args, options) => {
  const child = spawn(command, args, { stdio: 'inherit', ...options })
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`[stack] ${name} exited with ${code}`)
      stop(1)
    }
  })
  children.push(child)
}

const migrate = spawnSync(python, ['-m', 'alembic', 'upgrade', 'head'], {
  cwd: repoRoot,
  env: backendEnv,
  stdio: 'inherit',
})
if (migrate.status !== 0) stop(1)

start('backend', python, [path.join('backend', 'serve.py')], { cwd: repoRoot, env: backendEnv })

const healthUrl = `http://127.0.0.1:${apiPort}/api/v1/system/health`
for (let attempt = 0; ; attempt++) {
  try {
    if ((await fetch(healthUrl)).ok) break
  } catch {
    // Not listening yet.
  }
  if (attempt === 240) {
    console.error(`[stack] backend never answered ${healthUrl}`)
    stop(1)
  }
  await new Promise((resolve) => setTimeout(resolve, 250))
}

start(
  'vite',
  process.execPath,
  [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', vitePort, '--strictPort'],
  { cwd: frontendDir, env: { ...process.env, GSSG_API_TARGET: `http://127.0.0.1:${apiPort}` } },
)
console.log(`[stack] backend :${apiPort} (data ${dataDir}), vite :${vitePort}`)
