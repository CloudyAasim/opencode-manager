#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const DIST = path.resolve(import.meta.dirname, '../dist')
const PORT = Number(process.env.SMOKE_PORT ?? 4319)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    ...(process.env.HOME ? [`${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`] : []),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    'No chromium binary found. Set CHROMIUM_PATH to a chrome/chromium executable.',
  )
}

async function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let filePath = path.join(DIST, decodeURIComponent(url.pathname))
    try {
      const info = await stat(filePath).catch(() => null)
      if (!info || info.isDirectory()) filePath = path.join(DIST, 'index.html')
      const body = await readFile(filePath)
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
  return server
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: 'ignore' })
    child.on('close', resolve)
  })
}

const server = await serve()
let browser
let exitCode = 0

try {
  const chromiumPath = findChromium()
  browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] })
  const page = await (await browser.newContext()).newPage()

  const pageErrors = []
  const badResponses = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 400) {
      badResponses.push(`${response.status()} ${new URL(response.url()).pathname}`)
    }
  })

  const routes = ['/login', '/register']
  for (const route of routes) {
    pageErrors.length = 0
    badResponses.length = 0
    await page.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(500)

    const rootLength = await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? -1)
    const visible = await page.evaluate(() => document.body.innerText.trim().length)

    if (rootLength <= 0 || visible === 0) {
      console.error(`FAIL ${route}: app did not mount (root=${rootLength}, text=${visible})`)
      pageErrors.forEach((message) => console.error(`  pageerror: ${message}`))
      exitCode = 1
      continue
    }
    if (pageErrors.length > 0) {
      console.error(`FAIL ${route}: uncaught page error`)
      pageErrors.forEach((message) => console.error(`  ${message}`))
      exitCode = 1
      continue
    }

    const assetErrors = badResponses.filter((entry) => entry.includes('/assets/'))
    if (assetErrors.length > 0) {
      console.error(`FAIL ${route}: asset request failed`)
      assetErrors.forEach((entry) => console.error(`  ${entry}`))
      exitCode = 1
      continue
    }

    console.log(`ok ${route} (root=${rootLength})`)
  }
} finally {
  await browser?.close()
  server.close()
}

process.exit(exitCode)
