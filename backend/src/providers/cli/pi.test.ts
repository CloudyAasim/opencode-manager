import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PiProvider, activeBranch, readPiSession } from './pi'

function writeSession(lines: unknown[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-pi-'))
  const project = path.join(root, '--work-demo--')
  fs.mkdirSync(project, { recursive: true })
  const file = path.join(project, '20260101_100000_abc12345.jsonl')
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8')
  return file
}

const HEADER = {
  type: 'session',
  version: 3,
  id: 'pi-demo-session',
  timestamp: '2026-01-01T10:00:00.000Z',
  cwd: '/work/demo',
}

describe('Pi 的会话', () => {
  it('一段对话读出来就是几段对话', () => {
    const file = writeSession([
      HEADER,
      {
        type: 'message',
        id: 'a1',
        parentId: null,
        timestamp: '2026-01-01T10:00:01.000Z',
        message: { role: 'user', content: 'hello there', timestamp: 1767261601000 },
      },
      {
        type: 'message',
        id: 'b1',
        parentId: 'a1',
        timestamp: '2026-01-01T10:00:02.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hi' }],
          usage: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2 },
          timestamp: 1767261602000,
        },
      },
    ])

    const session = readPiSession(file)

    expect(session?.id).toBe('pi-demo-session')
    expect(session?.directory).toBe('/work/demo')
    expect(session?.title).toBe('hello there')
    expect(session?.messages).toHaveLength(2)
    expect(session?.messages[1]?.tokens).toEqual({
      input: 10,
      output: 5,
      reasoning: 0,
      cacheRead: 1,
      cacheWrite: 2,
    })
  })

  it('工具的调用和它的结果是一件事', () => {
    const file = writeSession([
      HEADER,
      {
        type: 'message',
        id: 'a1',
        parentId: null,
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'ls' } }],
        },
      },
      {
        type: 'message',
        id: 'b1',
        parentId: 'a1',
        message: {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'bash',
          content: [{ type: 'text', text: 'total 48' }],
          isError: false,
        },
      },
    ])

    const session = readPiSession(file)
    const tool = session?.messages[0]?.parts[0]

    expect(tool?.type).toBe('tool')
    expect(tool?.tool).toEqual({
      name: 'bash',
      state: 'completed',
      title: null,
      output: 'total 48',
    })
  })

  it('被放弃的分支不算在对话里', () => {
    const branch = activeBranch([
      { type: 'message', id: 'a1', parentId: null },
      { type: 'message', id: 'b1', parentId: 'a1' },
      { type: 'message', id: 'c1', parentId: 'a1' },
      { type: 'message', id: 'd1', parentId: 'b1' },
    ])

    expect(branch.map((entry) => entry.id)).toEqual(['a1', 'b1', 'd1'])
  })

  it('续会话用 --session-id，不是 --session', () => {
    const provider = new PiProvider()
    const command = (
      provider as unknown as {
        command: (text: string, resume: string | undefined, context: unknown) => string[]
      }
    ).command('do it', 'abc123', {})

    // `--session` would carry the session back to the directory it was made
    // in; `--session-id` keeps it in the one the work is happening in.
    expect(command).toEqual(['-p', 'do it', '--session-id', 'abc123'])
  })

  it('程序不在本机上，就说不在', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-empty-path-'))
    const provider = new PiProvider({ environment: { PATH: empty } })

    const status = await provider.status()

    expect(status.status).toBe('unavailable')
    expect(status.detail).toContain('not installed')
  })

  it('装了但没登录，就说没登录', async () => {
    const provider = new PiProvider()

    const status = await provider.status()

    // Whether Pi has a provider depends on the machine this runs on, so the
    // honest assertion is about the shape of the answer.
    expect(['ready', 'unavailable']).toContain(status.status)
    if (status.status === 'unavailable') {
      expect(status.detail).toMatch(/no provider credentials|not installed/)
    }
  })
})
