import { describe, it, expect } from 'bun:test'
import * as http from 'http'
import { createIPCServer } from './ipcServer'

/**
 * The door the git credential service answers on, opened under the runtime
 * the product actually runs on.
 *
 * The rest of the suite runs under Node, and Node opens a Windows named pipe
 * where Bun cannot - Bun treats the name as a file and fails with ENOENT
 * before a server exists. A suite that only ever runs under Node therefore
 * says nothing about the runtime the product ships on, which is how a host
 * that could not open one door ended up answering 503 to everything while
 * its tests stayed green.
 *
 * So this one runs under Bun: it opens the door and talks to it, and it
 * fails if the handle the server hands out is one this runtime cannot open.
 */
describe('the git credential door', () => {
  it('answers on a handle this runtime can open', async () => {
    const server = await createIPCServer('bun-transport')

    try {
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = http.request(
          { socketPath: server.ipcHandlePath, path: '/askpass', method: 'POST' },
          res => {
            const chunks: Buffer[] = []
            res.on('data', (chunk: Buffer) => chunks.push(chunk))
            res.on('end', () => resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            }))
          },
        )
        request.on('error', reject)
        request.end('{}')
      })

      // The door answered. No handler is registered for this path, so 404 is
      // the answer of a door that is open.
      expect(response.status).toBe(404)
      expect(JSON.parse(response.body)).toEqual({ error: 'Handler not found' })
    } finally {
      await server.dispose()
    }
  })

  it('hands the client the same handle it opened', async () => {
    const server = await createIPCServer('bun-transport-handle')

    try {
      expect(server.getEnv()).toEqual({ VSCODE_GIT_IPC_HANDLE: server.ipcHandlePath })
      expect(server.ipcHandlePath).toContain('opencode-git-')
    } finally {
      await server.dispose()
    }
  })
})
