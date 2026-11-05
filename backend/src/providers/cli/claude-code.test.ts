import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClaudeCodeProvider, readClaudeSession } from './claude-code'

function writeSession(lines: unknown[]): { file: string; id: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-claude-'))
  const project = path.join(root, 'projects', '-work-demo')
  fs.mkdirSync(project, { recursive: true })
  const id = 'ses_abc123'
  const file = path.join(project, `${id}.jsonl`)
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8')
  return { file, id }
}

describe('Claude Code 的会话', () => {
  it('一段对话读出来就是几段对话', () => {
    const { file } = writeSession([
      {
        type: 'user',
        uuid: 'u1',
        sessionId: 'ses_abc123',
        cwd: '/work/demo',
        timestamp: '2026-01-01T10:00:00.000Z',
        message: { role: 'user', content: 'read the file please' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        sessionId: 'ses_abc123',
        cwd: '/work/demo',
        timestamp: '2026-01-01T10:00:01.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'on it' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.txt' } },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'u2',
        sessionId: 'ses_abc123',
        cwd: '/work/demo',
        timestamp: '2026-01-01T10:00:02.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'the file says hello' }],
        },
      },
    ])

    const session = readClaudeSession(file, 'ses_abc123')

    expect(session?.id).toBe('ses_abc123')
    expect(session?.directory).toBe('/work/demo')
    expect(session?.title).toBe('read the file please')
    expect(session?.messages).toHaveLength(2)
    expect(session?.messages[0]?.role).toBe('user')
    expect(session?.messages[1]?.parts).toHaveLength(2)
  })

  it('工具的调用和它的结果是一件事', () => {
    const { file } = writeSession([
      {
        type: 'assistant',
        uuid: 'a1',
        sessionId: 'ses_abc123',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }],
        },
      },
      {
        type: 'user',
        uuid: 'u2',
        sessionId: 'ses_abc123',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'the file says hello' }],
        },
      },
    ])

    const session = readClaudeSession(file, 'ses_abc123')
    const tool = session?.messages[0]?.parts[0]

    expect(tool?.type).toBe('tool')
    expect(tool?.tool).toEqual({
      name: 'Read',
      state: 'completed',
      title: null,
      output: 'the file says hello',
    })
  })

  it('工具失败了，状态就是失败', () => {
    const { file } = writeSession([
      {
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash' }] },
      },
      {
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'no such file', is_error: true }],
        },
      },
    ])

    const session = readClaudeSession(file, 'ses_abc123')

    expect(session?.messages[0]?.parts[0]?.tool?.state).toBe('error')
  })

  it('看不懂的行被跳过，而不是被猜', () => {
    const { file } = writeSession([
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } },
      { type: 'something-new', uuid: 'x1', payload: { anything: true } },
    ])

    const session = readClaudeSession(file, 'ses_abc123')

    expect(session?.messages).toHaveLength(1)
  })

  it('程序不在本机上，就说不在', async () => {
    // A directory of its own, because the temporary one is not guaranteed to
    // be empty of anything.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-empty-path-'))
    const provider = new ClaudeCodeProvider({ environment: { PATH: empty } })

    const status = await provider.status()

    expect(status.status).toBe('unavailable')
    expect(status.detail).toContain('not installed')
  })

  it('装了但没登录，就说没登录', async () => {
    const provider = new ClaudeCodeProvider()

    const status = await provider.status()

    // Whether it is signed in depends on the machine this runs on, so the
    // honest assertion is about the shape of the answer: it either says it
    // is ready, or it says what is missing.
    expect(['ready', 'unavailable']).toContain(status.status)
    if (status.status === 'unavailable') {
      expect(status.detail).toMatch(/not signed in|not installed/)
    }
  })

  it('登录了没有，它自己知道', async () => {
    const signedIn = installFakeClaude({ loggedIn: true })
    const signedOut = installFakeClaude({ loggedIn: false })

    const ready = await new ClaudeCodeProvider({ environment: { PATH: signedIn } }).status()
    const notReady = await new ClaudeCodeProvider({ environment: { PATH: signedOut } }).status()

    expect(ready.status).toBe('ready')
    expect(notReady.status).toBe('unavailable')
    expect(notReady.detail).toContain('not signed in')
  })
})

/**
 * A program that answers like Claude Code does when it is asked whether it
 * is signed in.
 */
function installFakeClaude(answer: { loggedIn: boolean }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-fake-claude-'))
  const isWindows = process.platform === 'win32'
  const file = path.join(dir, isWindows ? 'claude.cmd' : 'claude')
  const json = JSON.stringify(answer)
  fs.writeFileSync(file, isWindows ? `@echo off\r\necho ${json}\r\n` : `#!/bin/sh\necho '${json}'\n`)
  if (!isWindows) fs.chmodSync(file, 0o755)
  return dir
}

/**
 * A transcript as Claude Code actually writes one, taken from a real
 * session and stripped of the paths and the ids that belong to the machine
 * it was made on.
 *
 * It is here because two things in it are easy to get wrong and impossible
 * to invent: the bookkeeping lines at the top, and the local commands that
 * Claude Code writes as user messages even though nobody said them to the
 * agent.
 */
describe('真的一段 Claude Code 对话', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-claude-fixture-'))
  const file = path.join(dir, 'session.jsonl')
  fs.copyFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/claude-session.jsonl'),
    file,
  )
  const session = readClaudeSession(file, 'fallback')

  it('簿记不算对话', () => {
    // Two: what the person said, and what came back. The result of the tool
    // call belongs to the call, not to the conversation.
    expect(session?.messages).toHaveLength(2)
    expect(session?.messages[0]?.role).toBe('user')
    expect(session?.messages[0]?.parts[0]?.text).toBe('what does this repo do?')
  })

  it('本地命令不算对话', () => {
    const texts = session?.messages.flatMap((message) => message.parts.map((part) => part.text)) ?? []

    expect(texts).not.toContain('<command-name>/exit</command-name>')
    expect(texts).not.toContain('<local-command-stdout>Goodbye!</local-command-stdout>')
    expect(texts.some((text) => text?.includes('local-command-caveat'))).toBe(false)
  })

  it('工作目录是从消息里读出来的，不是从簿记里', () => {
    expect(session?.directory).toBe('C:\\work\\demo')
  })

  it('工具的调用和它的结果还是一件事', () => {
    const assistant = session?.messages[1]

    expect(assistant?.role).toBe('assistant')
    expect(assistant?.parts[0]?.text).toBe('It is a small library that reads the settings.')
    expect(assistant?.parts[1]?.tool).toEqual({
      name: 'Read',
      state: 'completed',
      title: null,
      output: '# Demo\nA small library.',
    })
  })

  it('标题是人说的第一句话', () => {
    expect(session?.title).toBe('what does this repo do?')
  })
})
