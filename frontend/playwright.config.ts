import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import path from 'node:path'

const CANDIDATE_BROWSERS = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  process.env.HOME
    ? path.join(process.env.HOME, '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome')
    : undefined,
].filter((value): value is string => Boolean(value))

const executablePath = CANDIDATE_BROWSERS.find((candidate) => existsSync(candidate))
const PORT = Number(process.env.E2E_PORT ?? 4400)

export default defineConfig({
  testDir: './e2e/specs',
  outputDir: './e2e-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `node e2e/helpers/static-server.mjs`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(PORT) },
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
