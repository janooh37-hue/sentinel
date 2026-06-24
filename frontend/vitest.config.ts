/// <reference types="vitest" />
import { defineConfig, mergeConfig } from 'vite'

import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Exclude Playwright E2E specs — they use @playwright/test's test() which
      // collides with Vitest's test(). Run E2E separately via `npm run e2e`.
      exclude: ['e2e/**', 'node_modules/**'],
    },
  }),
)
