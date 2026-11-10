import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CliAgentProvider, type CliSession } from './cli-agent'
import { jsonlLines } from './cli-process'

/**
 * An agent that is not Claude Code, not Pi, and not anything: a program that
 * prints one JSON object and stops. It is here so that the part of the
 * adapter that has nothing to do with any particular agent - finding the
 * program, running it, reading the session id out of what it printed - can be
 * proven on a machine where none of the real agents is installed.
 */
class FakeAgentProvider extends CliAgentProvider {
  readonly id = 'fake'
  readonly label = 'Fake Agent'
  protected readonly binary = 'fake-agent'

  /** The sessions the program left behind, for the tests that need some. */
  sessions: CliSession[] = []

  protected command(text: string): string[] {
    return ['--say', text]
  }

  protected readSessionId(output: string): string | null {
    for (const record of jsonlLines(output)) {
      const sessionId = (record as { session_id?: unknown }).session_id
      if (typeof sessionId === 'string' && sessionId) return sessionId
    }
    return null
  }

  protected readSessions(): CliSession[] {
    return this.sessions
  }

  protected sessionFile(): string | null {
    return null
  }
}

function installFakeAgent(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-fake-agent-'))
  const isWindows = process.platform === 'win32'
  const file = path.join(dir, isWindows ? 'fake-agent.cmd' : 'fake-agent')
  const script = isWindows
    ? '@echo off\r\necho {"session_id":"ses_from_cli"}\r\n'
    : '#!/bin/sh\necho \'{"session_id":"ses_from_cli"}\'\n'
  fs.writeFileSync(file, script)
  if (!isWindows) fs.chmodSync(file, 0o755)
  return dir
}

describe('把一个程序变成 agent', () => {
  it('程序在，就绪', async () => {
    const dir = installFakeAgent()
    const provider = new FakeAgentProvider({ environment: { PATH: dir } })

    const status = await provider.status()

    expect(status.status).toBe('ready')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('程序不在，就说不在，而且不假装', async () => {
    const provider = new FakeAgentProvider({ environment: { PATH: os.tmpdir() } })

    const status = await provider.status()

    expect(status.status).toBe('unavailable')
    await expect(provider.createSession({ title: 'hello' })).rejects.toThrow('not installed')
  })

  it('开一个会话，就是把程序跑起来，然后认出它做的是哪个会话', async () => {
    const dir = installFakeAgent()
    const provider = new FakeAgentProvider({ environment: { PATH: dir } })

    const session = await provider.createSession({ title: 'fix the parser' })

    expect(session.id).toBe('ses_from_cli')
    expect(session.agentId).toBe('fake')
    expect(session.title).toBe('fix the parser')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('程序说的话不是 JSON，就是没有会话', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-fake-agent-'))
    const isWindows = process.platform === 'win32'
    const file = path.join(dir, isWindows ? 'fake-agent.cmd' : 'fake-agent')
    fs.writeFileSync(file, isWindows ? '@echo off\r\necho hello\r\n' : '#!/bin/sh\necho hello\n')
    if (!isWindows) fs.chmodSync(file, 0o755)
    const provider = new FakeAgentProvider({ environment: { PATH: dir } })

    await expect(provider.createSession({ title: 'x' })).rejects.toThrow('did not report a session')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('文件里没写目录的时候，用问的那个目录', async () => {
    const provider = new FakeAgentProvider({})
    provider.sessions = [
      { id: 'ses_1', title: 'One', directory: null, createdAt: 1, updatedAt: 2, messages: [] },
    ]

    const page = await provider.listSessions({ directory: '/work' })

    // 程序答的是"这个目录的会话"，所以会话就是这个目录的。
    expect(page.items[0]?.directory).toBe('/work')
  })

  it('文件里写了目录的时候，就用它自己的', async () => {
    const provider = new FakeAgentProvider({})
    provider.sessions = [
      { id: 'ses_1', title: 'One', directory: '/elsewhere', createdAt: 1, updatedAt: 2, messages: [] },
    ]

    const page = await provider.listSessions({ directory: '/work' })

    expect(page.items[0]?.directory).toBe('/elsewhere')
  })
})
