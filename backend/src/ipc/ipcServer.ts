import * as http from 'http'
import * as crypto from 'crypto'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { logger } from '../utils/logger'

/**
 * Where the socket file lives when the host answers over a file rather than
 * over a pipe.
 */
function socketDirectory(): string {
  if (process.platform !== 'darwin' && process.env['XDG_RUNTIME_DIR']) {
    return process.env['XDG_RUNTIME_DIR']
  }
  return os.tmpdir()
}

/**
 * A Windows named pipe is not a file path, so there is nothing to unlink
 * from one and nothing to stat.
 */
function isNamedPipe(handlePath: string): boolean {
  return handlePath.startsWith('\\\\.\\pipe\\')
}

function listenOn(server: http.Server, handlePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener('error', onError)
      reject(error)
    }
    server.on('error', onError)
    server.listen(handlePath, () => {
      server.removeListener('error', onError)
      resolve()
    })
  })
}

/**
 * Can this runtime open a Windows named pipe at all?
 *
 * Node opens one. Bun - the runtime the product ships on - treats the name as
 * a file, fails with ENOENT and never reaches a server. The difference
 * belongs to the runtime rather than to the platform, so it is measured once
 * here instead of being written down as a table of runtimes that goes stale
 * the day one of them changes.
 */
async function namedPipesWork(): Promise<boolean> {
  const probe = `\\\\.\\pipe\\opencode-git-probe-${crypto.randomBytes(8).toString('hex')}`
  const server = http.createServer()
  // The probe's own failure is the answer being looked for; it must not be
  // raised again as an unhandled error.
  server.on('error', () => {
    void 0
  })
  try {
    await listenOn(server, probe)
  } catch {
    return false
  }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return true
}

/**
 * The handle the git credential door answers on.
 *
 * The client is handed the handle through the environment and opens it the
 * way its own runtime opens sockets, so the two ends only have to agree on
 * the path - which is what this decides.
 */
export async function resolveIPCHandlePath(context?: string): Promise<string> {
  const hash = crypto.createHash('sha256')

  if (!context) {
    const buffer = crypto.randomBytes(20)
    hash.update(buffer)
  } else {
    hash.update(context)
  }

  const id = hash.digest('hex').substring(0, 10)
  const socketFile = path.join(socketDirectory(), `opencode-git-${id}.sock`)

  if (process.platform !== 'win32') {
    return socketFile
  }
  if (await namedPipesWork()) {
    return `\\\\.\\pipe\\opencode-git-${id}-sock`
  }
  logger.warn('This runtime cannot open a Windows named pipe; the git credential socket will be a file')
  return socketFile
}

export interface IPCHandler {
  handle(request: unknown): Promise<unknown>
}

export class IPCServer {
  private handlers = new Map<string, IPCHandler>()

  constructor(
    private server: http.Server,
    public readonly ipcHandlePath: string
  ) {
    server.on('request', (req, res) => this.onRequest(req, res))
    // A door that breaks after it opened must not take the host down with
    // it. The credential service is a convenience, not a reason to stop.
    server.on('error', (error) => {
      logger.error('Git IPC server error:', error)
    })
  }

  registerHandler(name: string, handler: IPCHandler): void {
    this.handlers.set(`/${name}`, handler)
  }

  getHandler(name: string): IPCHandler | undefined {
    return this.handlers.get(`/${name}`)
  }

  getEnv(): Record<string, string> {
    return { VSCODE_GIT_IPC_HANDLE: this.ipcHandlePath }
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    logger.info(`IPC request received: url=${req.url}, method=${req.method}`)
    const handler = this.handlers.get(req.url || '')
    if (!handler) {
      logger.warn(`IPC handler not found for path: ${req.url}, registered paths: ${Array.from(this.handlers.keys()).join(', ')}`)
      res.writeHead(404)
      res.end(JSON.stringify({ error: 'Handler not found' }))
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (d: Buffer) => chunks.push(d))
    req.on('end', async () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8')
        logger.info(`IPC request body: "${body}"`)
        if (!body) {
          logger.warn(`Empty request body for path: ${req.url}`)
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Empty request body' }))
          return
        }
        const request = JSON.parse(body)
        logger.info(`IPC calling handler for ${req.url} with:`, request)
        const result = await handler.handle(request)
        logger.info(`IPC handler result for ${req.url}:`, result)
        res.writeHead(200)
        res.end(JSON.stringify(result))
      } catch (error) {
        logger.error(`IPC request error for path ${req.url}:`, error)
        res.writeHead(500)
        res.end(JSON.stringify({ error: 'Internal server error' }))
      }
    })
  }

  dispose(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve())
    })
  }
}

export async function createIPCServer(context?: string): Promise<IPCServer> {
  const handlePath = await resolveIPCHandlePath(context)

  // A socket file left behind by a host that did not shut down cleanly
  // keeps the next one from opening it. A named pipe leaves no file behind,
  // so there is nothing to clear.
  if (!isNamedPipe(handlePath)) {
    try {
      await fs.unlink(handlePath)
    } catch {
      void 0
    }
  }

  const server = http.createServer()
  const ipcServer = new IPCServer(server, handlePath)
  try {
    await listenOn(server, handlePath)
  } catch (error) {
    server.close()
    throw error
  }
  return ipcServer
}
