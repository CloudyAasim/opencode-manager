import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // The main process imports `electron`, which only exists inside the
      // Electron runtime. Aliasing it to a stub is what lets the real wiring -
      // proxy startup, window setup, navigation guards, IPC - be exercised here.
      electron: path.join(here, 'test/electron-stub.ts'),
      // `desktop/src/proxy.ts` imports a workspace dependency by bare specifier,
      // which resolves through `desktop/node_modules` in a working checkout.
      // This directory installs with npm and is not a workspace member, so the
      // test job points at the same file directly - the alternative is a second
      // package manager install in the same job just to satisfy one import.
      '@opencode-manager/shared/utils/server-url': path.join(
        here,
        '../shared/src/utils/server-url.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    // Each case boots a real proxy on a real port and shares one stub;
    // parallel files would race for the same stub state.
    fileParallelism: false,
  },
})