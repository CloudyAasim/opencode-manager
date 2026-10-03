import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Booting src/index.ts is the heaviest thing in this suite: it runs
    // migrations, warms the assistant workspace and starts the server manager.
    // On a loaded runner that clears vitest's 5000ms default and fails a
    // suite that is otherwise perfectly green - which is what the CI Test job
    // did twice. The frontend already allows 20s for the same reason.
    testTimeout: 20000,
    hookTimeout: 20000,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.{test,spec}.{ts,tsx}', 'src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/routes/repos.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    env: {
      NODE_ENV: 'test',
      PORT: '3001',
      DATABASE_PATH: ':memory:',
      AUTH_SECRET: 'test-secret-for-encryption',
      WORKSPACE_PATH: '/tmp/test-workspace',
    },
  },
  resolve: {
    alias: {
      'bun:sqlite': path.resolve(__dirname, './test/mocks/bun-sqlite.ts'),
      'bun:test': path.resolve(__dirname, './test/mocks/bun-test.ts'),
    },
  },
})
