import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'
import * as http from 'http'
import type { AddressInfo } from 'net'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { repoRoot } from '../helpers/repo-root'

/**
 * The script this covers is the one that decides whether a deploy actually
 * reached the public site. It is the difference between "the deploy step
 * said OK" and "the site is serving this build", and the second is the
 * one that matters: a deploy can fail on the host while the old container
 * keeps answering, and then the site is healthy and wrong at the same
 * time.
 *
 * The checks run against a local server rather than the real site, so the
 * suite does not depend on the network and cannot be fooled by whatever
 * production happens to be serving.
 */

const scriptPath = join(repoRoot, 'scripts/verify-production-deploy.mjs')

const BUILD_JS = 'main-U_JwcwNH.js'
const BUILD_CSS = 'main-B8GonXf2.css'
const OTHER_JS = 'main-D1B8U2B8.js'

const indexHtml = (js: string, css: string) => `<!doctype html>
<html lang="en">
  <head>
    <script type="module" crossorigin src="/assets/${js}"></script>
    <link rel="stylesheet" crossorigin href="/assets/${css}">
  </head>
  <body><div id="root"></div></body>
</html>`

interface GateRun {
  status: number | null
  stdout: string
  stderr: string
}

let distDir: string

const makeDist = (js: string | null, css: string | null) => {
  const dir = join(tmpdir(), `ocm-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dir, 'assets'), { recursive: true })
  if (js) writeFileSync(join(dir, 'assets', js), '// built\n')
  if (css) writeFileSync(join(dir, 'assets', css), '/* built */\n')
  return dir
}

const runGate = (args: string[]): Promise<GateRun> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args])
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (status) =>
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    )
  })

/** A server that answers every request with `handler`. */
const startServer = (
  handler: (requestNumber: number) => { status: number; body: string },
): Promise<{ url: string; close: () => Promise<void> }> =>
  new Promise((resolve) => {
    let requests = 0
    const server = http.createServer((_req, res) => {
      const answer = handler(requests++)
      res.writeHead(answer.status, { 'content-type': 'text/html' })
      res.end(answer.body)
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })

beforeEach(() => {
  distDir = makeDist(BUILD_JS, BUILD_CSS)
})

afterEach(() => {
  rmSync(distDir, { recursive: true, force: true })
})

describe('verify-production-deploy', () => {
  it('passes when the site serves exactly this build', async () => {
    const server = await startServer(() => ({
      status: 200,
      body: indexHtml(BUILD_JS, BUILD_CSS),
    }))
    try {
      const run = await runGate([
        '--site', server.url,
        '--dist', distDir,
        '--timeout', '10',
        '--interval', '1',
      ])
      expect(run.status).toBe(0)
      expect(run.stdout).toContain('the site is serving this build')
      expect(run.stdout).toContain(BUILD_JS)
    } finally {
      await server.close()
    }
  })

  it('fails when the site is serving a different build', async () => {
    const server = await startServer(() => ({
      status: 200,
      body: indexHtml(OTHER_JS, BUILD_CSS),
    }))
    try {
      const run = await runGate([
        '--site', server.url,
        '--dist', distDir,
        '--timeout', '3',
        '--interval', '1',
      ])
      expect(run.status).toBe(1)
      // The failure has to say what was expected and what was seen, or the
      // person reading a red deploy has nothing to act on.
      expect(run.stderr).toContain(BUILD_JS)
      expect(run.stderr).toContain(OTHER_JS)
    } finally {
      await server.close()
    }
  })

  it('waits for the site to catch up instead of failing on the first mismatch', async () => {
    // The swap is not instantaneous, and a check that failed on a site
    // that was a second away from being right would be a check that
    // cries wolf.
    const server = await startServer((requestNumber) =>
      requestNumber < 2
        ? { status: 200, body: indexHtml(OTHER_JS, BUILD_CSS) }
        : { status: 200, body: indexHtml(BUILD_JS, BUILD_CSS) },
    )
    try {
      const run = await runGate([
        '--site', server.url,
        '--dist', distDir,
        '--timeout', '20',
        '--interval', '1',
      ])
      expect(run.status).toBe(0)
      expect(run.stdout).toContain('the site is serving this build')
    } finally {
      await server.close()
    }
  })

  it('fails when the site cannot be reached', async () => {
    // Port 9 is the discard port; nothing listens on it.
    const run = await runGate([
      '--site', 'http://127.0.0.1:9',
      '--dist', distDir,
      '--timeout', '3',
      '--interval', '1',
    ])
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('the site could not be read')
  })

  it('fails when the site answers with an error', async () => {
    const server = await startServer(() => ({ status: 503, body: 'unavailable' }))
    try {
      const run = await runGate([
        '--site', server.url,
        '--dist', distDir,
        '--timeout', '3',
        '--interval', '1',
      ])
      expect(run.status).toBe(1)
      expect(run.stderr).toContain('503')
    } finally {
      await server.close()
    }
  })

  it('refuses to compare when there is no build to compare against', async () => {
    // A comparison against "whatever was there" proves nothing, so an
    // empty or ambiguous build output has to stop the check rather than
    // let it pass on a technicality.
    const empty = makeDist(null, null)
    const ambiguous = makeDist(null, null)
    writeFileSync(join(ambiguous, 'assets', 'main-ONE.js'), '// a\n')
    writeFileSync(join(ambiguous, 'assets', 'main-TWO.js'), '// b\n')
    try {
      const emptyRun = await runGate(['--site', 'http://127.0.0.1:9', '--dist', empty])
      expect(emptyRun.status).toBe(2)
      expect(emptyRun.stderr).toContain('exactly one main-*.js')

      const ambiguousRun = await runGate(['--site', 'http://127.0.0.1:9', '--dist', ambiguous])
      expect(ambiguousRun.status).toBe(2)
      expect(ambiguousRun.stderr).toContain('exactly one main-*.js')
    } finally {
      rmSync(empty, { recursive: true, force: true })
      rmSync(ambiguous, { recursive: true, force: true })
    }
  })

  it('refuses to run without a site and a build', async () => {
    const noSite = await runGate(['--dist', distDir])
    expect(noSite.status).toBe(2)
    expect(noSite.stderr).toContain('--site is required')

    const noDist = await runGate(['--site', 'http://127.0.0.1:9'])
    expect(noDist.status).toBe(2)
    expect(noDist.stderr).toContain('--dist is required')

    const unknown = await runGate(['--site', 'http://127.0.0.1:9', '--dist', distDir, '--wat'])
    expect(unknown.status).toBe(2)
    expect(unknown.stderr).toContain('unknown argument')
  })
})
