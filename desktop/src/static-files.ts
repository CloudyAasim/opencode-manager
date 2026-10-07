import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { ServerResponse } from 'node:http'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/**
 * `config.js` is served by the app, not fingerprinted by the bundler, so it
 * must never be cached. Same for the document itself: the document names the
 * hashed assets, and a cached document is how a user gets a stale shell that
 * points at assets which no longer exist.
 */
const NEVER_CACHE = new Set(['/index.html', '/config.js', '/manifest.webmanifest'])

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

export type StaticResult = { served: boolean; status: number }

export async function serveStaticFile(
  root: string,
  requestPath: string,
  res: ServerResponse,
): Promise<StaticResult> {
  const decoded = safeDecode(requestPath)
  if (decoded === null) return { served: false, status: 400 }

  const candidate = path.resolve(root, '.' + decoded)
  // path.resolve collapses `..`; anything escaping the root is a 404, not a
  // read of whatever happens to be one level up.
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    return { served: false, status: 404 }
  }

  let filePath = candidate
  let info = await statOrNull(filePath)
  if (info?.isDirectory()) {
    filePath = path.join(filePath, 'index.html')
    info = await statOrNull(filePath)
  }

  if (!info?.isFile()) {
    // SPA fallback: any unknown path renders the app, which then routes on the
    // client. The upstream does exactly this too, so behaviour matches.
    filePath = path.join(root, 'index.html')
    info = await statOrNull(filePath)
    if (!info?.isFile()) return { served: false, status: 404 }
  }

  const headers: Record<string, string> = {
    'content-type': contentTypeFor(filePath),
    'content-length': String(info.size),
  }

  if (NEVER_CACHE.has(decoded)) {
    headers['cache-control'] = 'no-cache, no-store, must-revalidate'
  } else if (decoded.startsWith('/assets/')) {
    // Vite puts a content hash in these names.
    headers['cache-control'] = 'public, max-age=31536000, immutable'
  } else {
    headers['cache-control'] = 'public, max-age=3600'
  }

  res.writeHead(200, headers)
  await new Promise<void>((resolve) => {
    const stream = createReadStream(filePath)
    stream.on('error', () => {
      res.destroy()
      resolve()
    })
    stream.on('end', resolve)
    res.on('close', () => stream.destroy())
    stream.pipe(res)
  })

  return { served: true, status: 200 }
}

function safeDecode(requestPath: string): string | null {
  try {
    const decoded = decodeURIComponent(requestPath)
    if (decoded.includes('\0')) return null
    return decoded
  } catch {
    return null
  }
}

async function statOrNull(filePath: string) {
  try {
    return await stat(filePath)
  } catch {
    return null
  }
}