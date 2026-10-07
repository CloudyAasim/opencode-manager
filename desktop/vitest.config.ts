import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // These tests bind real sockets and stream real bytes. Running files in
    // parallel is fine, but they must not be shuffled into a shared port.
    fileParallelism: true,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})