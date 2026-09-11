import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

const DEFAULT_PORT = 41_783
const EXISTING_SERVER_SWITCH = 'LOCK_WORD_HANDOFF_USE_EXISTING_SERVER'
const BASE_URL_ENV = 'LOCK_WORD_HANDOFF_BASE_URL'
const PORT_ENV = 'LOCK_WORD_HANDOFF_PORT'

function readPort(): number {
  const value = process.env[PORT_ENV] ?? String(DEFAULT_PORT)
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(`${PORT_ENV} must be an integer between 1024 and 65535`)
  }
  return port
}

function readLoopbackBaseURL(port: number): string {
  const configured = process.env[BASE_URL_ENV]
  const url = new URL(configured ?? `http://127.0.0.1:${port}`)
  const loopbackHosts: Record<string, true> = {
    '127.0.0.1': true,
    localhost: true,
    '[::1]': true,
  }
  if (!loopbackHosts[url.hostname]) {
    throw new Error(`${BASE_URL_ENV} must point to a loopback host`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${BASE_URL_ENV} must use http or https`)
  }
  return url.origin
}

const port = readPort()
const baseURL = readLoopbackBaseURL(port)
const useExistingServer = process.env[EXISTING_SERVER_SWITCH] === '1'
const frontendDir = fileURLToPath(new URL('..', import.meta.url))
const testDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  testDir,
  testMatch: 'lock-word-handoff.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 45_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  ...(useExistingServer
    ? {}
    : {
        webServer: {
          command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
          cwd: frontendDir,
          env: {
            ...process.env,
            GSSG_API_TARGET: 'http://lock-handoff-test.invalid',
          },
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
})
