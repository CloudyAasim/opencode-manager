import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
    const provider = new ClaudeCodeProvider()

    const status = await provider.status()

    expect(status.status).toBe('unavailable')
    expect(status.detail).toContain('Claude Code')
  })
})
