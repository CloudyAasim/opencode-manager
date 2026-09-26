import { describe, it, expect, vi } from 'vitest'
import { FakePtyProcess } from '../helpers/fake-pty'
import { TerminalSession } from '../../src/services/terminal/session'

function createSession(overrides: Partial<ConstructorParameters<typeof TerminalSession>[0]> = {}) {
  const pty = new FakePtyProcess()
  const session = new TerminalSession(
    {
      id: 'session-1',
      userId: 'user-1',
      userEmail: 'user@example.com',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      shell: '/bin/bash',
      cwd: '/workspace',
      cols: 80,
      rows: 24,
      ...overrides,
    },
    pty,
  )
  return { session, pty }
}

describe('TerminalSession', () => {
  it('forwards input to the PTY and updates activity', () => {
    const { session, pty } = createSession()

    session.write('echo hello\n')

    expect(pty.written).toEqual(['echo hello\n'])
    expect(session.lastActivityAt).toBeGreaterThanOrEqual(session.createdAt)
  })

  it('assigns increasing sequence numbers and streams chunks to subscribers', () => {
    const { session, pty } = createSession()
    const seen: number[] = []
    session.attach({ onOutput: (chunk) => seen.push(chunk.seq), onExit: () => {} }, 0)

    pty.emitData('a')
    pty.emitData('b')

    expect(seen).toEqual([1, 2])
    expect(session.stats.seq).toBe(2)
  })

  it('replays only chunks newer than the requested sequence to late subscribers', () => {
    const { session, pty } = createSession()
    pty.emitData('first')
    pty.emitData('second')
    pty.emitData('third')

    const replayed: string[] = []
    session.attach({ onOutput: (chunk) => replayed.push(chunk.data), onExit: () => {} }, 1)

    expect(replayed).toEqual(['second', 'third'])
  })

  it('trims the replay buffer to the configured byte budget', () => {
    const { session, pty } = createSession({ maxBufferBytes: 10 })
    pty.emitData('12345')
    pty.emitData('67890')
    pty.emitData('abcde')

    const replayed: string[] = []
    session.attach({ onOutput: (chunk) => replayed.push(chunk.data), onExit: () => {} }, 0)

    expect(replayed.join('')).toBe('67890abcde')
  })

  it('applies resize to the PTY and clamps invalid values', () => {
    const { session, pty } = createSession()

    session.resize(120, 40)
    session.resize(0, -5)

    expect(pty.resizes).toEqual([{ cols: 120, rows: 40 }])
    expect(session.dimensions).toEqual({ cols: 120, rows: 40 })
  })

  it('notifies exit listeners and subscribers with the close reason', () => {
    const { session, pty } = createSession()
    const exits: Array<{ code: number | null; reason: string }> = []
    const subscriberExits: string[] = []
    session.onExit((exit) => exits.push(exit))
    session.attach({ onOutput: () => {}, onExit: (exit) => subscriberExits.push(exit.reason) }, 0)

    session.close('user-closed')

    expect(pty.killed).toBe(true)
    expect(exits).toEqual([{ code: 0, reason: 'user-closed' }])
    expect(subscriberExits).toEqual(['user-closed'])
    expect(session.isExited).toBe(true)
  })

  it('delivers queued exit info to listeners registered after the process exited', async () => {
    const { session, pty } = createSession()
    pty.emitExit(137)

    const exit = await new Promise<{ code: number | null; reason: string }>((resolve) => {
      session.onExit(resolve)
    })

    expect(exit.code).toBe(137)
    expect(exit.reason).toBe('process-exited')
  })

  it('ignores writes after exit', () => {
    const { session, pty } = createSession()
    pty.emitExit(0)

    session.write('ignored')

    expect(pty.written).toEqual([])
  })

  it('disposes listeners so later PTY output is not delivered', () => {
    const { session, pty } = createSession()
    const listener = vi.fn()
    session.attach({ onOutput: listener, onExit: () => {} }, 0)

    session.dispose()
    pty.emitData('after-dispose')

    expect(listener).not.toHaveBeenCalled()
  })
})
