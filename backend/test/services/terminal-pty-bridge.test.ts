import { describe, it, expect } from 'vitest'
import { NodePtySpawner } from '../../src/services/terminal/pty'

const spawner = new NodePtySpawner()
const available = spawner.available()

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(!available)('terminal PTY bridge', () => {
  it('runs an interactive shell in a PTY and streams its output', async () => {
    const pty = spawner.spawn({ shell: '/bin/sh', cwd: '/tmp', cols: 80, rows: 24 })
    const chunks: string[] = []
    pty.onData((chunk) => chunks.push(chunk))
    const exited = new Promise<number | null>((resolve) => pty.onExit(resolve))

    await wait(150)
    pty.write('echo hello-from-pty\n')
    await wait(150)
    pty.write('exit\n')

    const code = await exited
    expect(chunks.join('')).toContain('hello-from-pty')
    expect(code).toBe(0)
  }, 20000)

  it('keeps running after a resize', async () => {
    const pty = spawner.spawn({ shell: '/bin/sh', cwd: '/tmp', cols: 80, rows: 24 })
    const chunks: string[] = []
    pty.onData((chunk) => chunks.push(chunk))
    const exited = new Promise<number | null>((resolve) => pty.onExit(resolve))

    await wait(150)
    pty.resize(120, 40)
    await wait(150)
    pty.write('echo resized-ok\n')
    await wait(150)
    pty.write('exit\n')

    await exited
    expect(chunks.join('')).toContain('resized-ok')
  }, 20000)
})
