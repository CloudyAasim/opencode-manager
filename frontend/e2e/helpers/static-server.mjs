import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const DIST = path.resolve(import.meta.dirname, '../../dist')
const PORT = Number(process.env.E2E_PORT ?? 4400)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

if (!existsSync(DIST)) {
  console.error(`[e2e] dist not found at ${DIST}. Run "pnpm build" first.`)
  process.exit(1)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)

  if (url.pathname === '/sw.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    res.end('self.addEventListener("install", () => self.skipWaiting());self.addEventListener("activate", () => self.clients.claim());')
    return
  }

  let filePath = path.join(DIST, decodeURIComponent(url.pathname))
  const info = await stat(filePath).catch(() => null)

  if (!info || info.isDirectory()) {
    filePath = path.join(DIST, 'index.html')
  }

  try {
    const body = await readFile(filePath)
    const ext = path.extname(filePath)
    const isHashed = /-[A-Za-z0-9_-]{8,}\./.test(path.basename(filePath))
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': isHashed ? 'public, max-age=31536000, immutable' : 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[e2e] serving ${DIST} on http://127.0.0.1:${PORT}`)
})
