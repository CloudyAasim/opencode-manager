#!/usr/bin/env node
/**
 * Check that the public site is serving *this* build.
 *
 * A finished deploy is not the same as a site that serves the new build,
 * and the two come apart in ways that are easy to miss:
 *
 * - The deploy can fail on the host - a build that stalls, a container
 *   that never becomes healthy - while the old container goes on serving
 *   traffic. The site answers, it is healthy, and it is the old version.
 * - The deploy can succeed while the public entry point is still being
 *   served from a cache somewhere in front of the container.
 *
 * Neither is visible from the deploy workflow's own exit code, and both
 * have the same symptom: the site looks fine. The only thing that settles
 * it is what the site actually serves.
 *
 * So this compares the asset names the site references against the ones
 * this commit's frontend build produced.
 *
 * The asset name is not decoration. Vite writes `assets/main-<hash>.js`
 * where `<hash>` is derived from the chunk's contents, so two builds that
 * produce the same name produced the same bytes. Comparing names is
 * comparing content.
 *
 * Usage:
 *   node scripts/verify-production-deploy.mjs --site <url> --dist <dir>
 *                                            [--timeout <s>] [--interval <s>]
 *
 * Exit codes:
 *   0  the site serves this build
 *   1  the site does not serve this build (wrong build, or never got there)
 *   2  the check could not be made - bad arguments, or no build to compare
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import http from 'node:http'
import https from 'node:https'

const USAGE = `Usage: node scripts/verify-production-deploy.mjs --site <url> --dist <dir>
                                         [--timeout <seconds>] [--interval <seconds>]

  --site     base URL of the deployed site, e.g. https://example.com
  --dist     built frontend directory, i.e. the one holding assets/
  --timeout  how long to keep waiting for the site to catch up (default 180)
  --interval seconds between attempts (default 10)`

const JS_ASSET = /^main-[\w-]+\.js$/
const CSS_ASSET = /^main-[\w-]+\.css$/

/** The arguments were wrong, or there is nothing to compare against. */
class UsageError extends Error {}

function parseArgs(argv) {
  const options = { site: '', dist: '', timeout: 180, interval: 10 }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value === undefined) throw new UsageError(`${arg} needs a value`)
      return value
    }
    switch (arg) {
      case '--site':
        options.site = next()
        break
      case '--dist':
        options.dist = next()
        break
      case '--timeout':
        options.timeout = Number(next())
        break
      case '--interval':
        options.interval = Number(next())
        break
      case '-h':
      case '--help':
        process.stdout.write(`${USAGE}\n`)
        process.exit(0)
      default:
        throw new UsageError(`unknown argument: ${arg}`)
    }
  }

  if (!options.site) throw new UsageError('--site is required')
  if (!options.dist) throw new UsageError('--dist is required')
  if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
    throw new UsageError('--timeout must be a positive number of seconds')
  }
  if (!Number.isFinite(options.interval) || options.interval <= 0) {
    throw new UsageError('--interval must be a positive number of seconds')
  }
  return options
}

/**
 * The one JavaScript and one stylesheet this build produced.
 *
 * Exactly one of each, because a comparison against "whatever was there"
 * proves nothing - and because a build that emitted several main bundles
 * is not the build the site is supposed to be serving.
 */
export async function expectedAssets(distDir) {
  const assetsDir = join(distDir, 'assets')
  let entries
  try {
    entries = await readdir(assetsDir)
  } catch (error) {
    throw new UsageError(`no build output at ${assetsDir} (${error.message})`)
  }

  const js = entries.filter((name) => JS_ASSET.test(name))
  const css = entries.filter((name) => CSS_ASSET.test(name))

  if (js.length !== 1) {
    throw new UsageError(
      `expected exactly one main-*.js in ${assetsDir}, found ${js.length}` +
        (js.length ? `: ${js.join(', ')}` : ''),
    )
  }
  if (css.length !== 1) {
    throw new UsageError(
      `expected exactly one main-*.css in ${assetsDir}, found ${css.length}` +
        (css.length ? `: ${css.join(', ')}` : ''),
    )
  }

  return { js: js[0], css: css[0] }
}

/** The main assets an HTML document references. */
export function servedAssetsFromHtml(html) {
  const collect = (pattern) => {
    const found = new Set()
    for (const match of html.matchAll(new RegExp(`assets/(${pattern})`, 'g'))) {
      found.add(match[1])
    }
    return [...found]
  }
  return {
    js: collect('main-[\\w-]+\\.js'),
    css: collect('main-[\\w-]+\\.css'),
  }
}

/**
 * One GET, without a keep-alive socket.
 *
 * `fetch` would do, but its global agent pools the connection, and exiting
 * while that socket is still open trips a libuv assertion on Windows
 * (`UV_HANDLE_CLOSING`) - so a check that *succeeded* would exit with a
 * crash code. `agent: false` closes the socket with the response, and the
 * process can exit cleanly.
 */
function httpGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const request = lib.get(
      url,
      { agent: false, headers: { 'cache-control': 'no-cache' } },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
        response.on('error', reject)
      },
    )
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`the request timed out after ${timeoutMs}ms`))
    })
    request.on('error', reject)
  })
}

/** What the site is serving right now. */
export async function fetchServedAssets(site, timeoutMs = 15000) {
  // The query string is there to defeat a cache in front of the site: the
  // path is still `/`, so the server answers exactly as it would without
  // it, but nothing that keyed on the bare URL can answer from a cache.
  let url = new URL('/', site)
  url.searchParams.set('verify', Date.now().toString())

  for (let hop = 0; hop < 5; hop++) {
    const response = await httpGet(url, timeoutMs)
    if (response.status >= 300 && response.status < 400 && response.location) {
      url = new URL(response.location, url)
      continue
    }
    if (response.status !== 200) {
      throw new Error(`GET ${url.pathname} answered ${response.status}`)
    }
    return servedAssetsFromHtml(response.body)
  }

  throw new Error('the site redirected too many times')
}

const sameAssets = (served, expected) =>
  served.js.length === 1 &&
  served.css.length === 1 &&
  served.js[0] === expected.js &&
  served.css[0] === expected.css

/**
 * Wait for the site to serve this build.
 *
 * The wait is not politeness. A deploy that has just finished can still
 * be a second or two away from being the thing in front of the public
 * address, and a check that failed on that would be a check that cries
 * wolf.
 */
export async function verifyDeployment({ site, dist, timeout, interval, onAttempt }) {
  const expected = await expectedAssets(dist)
  const deadline = Date.now() + timeout * 1000
  let lastProblem = 'the site was never reached'
  let attempts = 0

  for (;;) {
    attempts++
    let served
    try {
      served = await fetchServedAssets(site)
      if (sameAssets(served, expected)) {
        return { expected, served, attempts }
      }
      lastProblem = `the site serves js=${served.js.join(',') || '(none)'} css=${served.css.join(',') || '(none)'}`
    } catch (error) {
      lastProblem = `the site could not be read (${error.message})`
    }

    if (Date.now() >= deadline) break
    onAttempt?.(lastProblem, attempts)
    await new Promise((resolve) => setTimeout(resolve, interval * 1000))
  }

  throw new Error(
    `the site did not serve this build after ${timeout}s.\n` +
      `  expected js=${expected.js} css=${expected.css}\n` +
      `  last seen: ${lastProblem}`,
  )
}

export async function main(argv) {
  const options = parseArgs(argv)
  const result = await verifyDeployment({
    ...options,
    onAttempt: (problem, attempts) => {
      process.stdout.write(`  ... attempt ${attempts}: ${problem}; still waiting\n`)
    },
  })
  process.stdout.write(
    `the site is serving this build: ${result.expected.js} / ${result.expected.css}\n`,
  )
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      if (error instanceof UsageError) {
        process.stderr.write(`${error.message}\n\n${USAGE}\n`)
        process.exit(2)
      }
      process.stderr.write(`${error?.message ?? String(error)}\n`)
      process.exit(1)
    },
  )
}
