import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The mirror suite drives real git: init, clone, bundle, worktree. On a
    // loaded runner that clears vitest's 5000ms default and fails a suite that
    // is otherwise perfectly green - which is what the CI Test job did twice
    // in the backend, and what the Windows runner does here, where git is
    // slower to begin with.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
