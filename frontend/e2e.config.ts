import type { E2EConfig } from 'e2e'
import { web } from '@e2e-dev/web'
import { codex } from '@e2e-dev/acp'

// Agentic end-to-end tests (e2e by TesterArmy). The Playwright suite in
// e2e/*.spec.ts is separate and unchanged.
//
//   pnpm -C frontend run e2e:agentic
//
// Each run boots a throwaway stack (fresh SQLite, migrated backend, Vite) via
// e2e/agentic/stack.mjs, so tests start from an empty database whose first
// registered account becomes the admin. agent.* steps run on Codex with its
// own login (`codex login`); tests without agent steps need no model.
export default {
  tests: 'e2e/agentic/**/*.e2e.ts',
  targets: [
    {
      engine: web(),
      app: {
        url: 'http://127.0.0.1:0',
        command: {
          executable: 'node',
          args: ['e2e/agentic/stack.mjs', '{port}'],
          inheritEnv: ['GSSG_PYTHON'],
          startupTimeout: 180_000,
          log: '.e2e/logs/app.log',
        },
      },
    },
  ],
  agents: {
    default: {
      executor: codex({
        system:
          'You test GSSG Manager, a bilingual (English/Arabic) HR and document console. ' +
          'Use only what the screen shows; never guess hidden state.',
      }),
    },
  },
  // Accounts exist only in the run's throwaway database.
  credentials: {
    admin: {
      username: 'admin@gssg.test',
      password: () => process.env.E2E_USER_ADMIN_PASSWORD ?? 'e2e-throwaway-admin',
    },
  },
  // One stack per run: every test file shares its database, so keep them serial.
  workers: 1,
  // A live Codex step can take over a minute; the 120 s default cuts a
  // three-goal test short when nothing replays from the cache.
  timeout: 300_000,
} satisfies E2EConfig
