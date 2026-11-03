import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findExecutable, jsonlLines, runCli } from './cli-process'

function makeProgram(): { file: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-cli-'))
  const isWindows = process.platform === 'win32'
  const file = path.join(dir, isWindows ? 'fake-agent.cmd' : 'fake-agent')
  const script = isWindows
    ? '@echo off\r\necho hello from the agent\r\n'
    : '#!/bin/sh\necho "hello from the agent"\n'
  fs.writeFileSync(file, script)
  if (!isWindows) fs.chmodSync(file, 0o755)
  return { file, dir }
}

describe('跑一个本机上的 agent 程序', () => {
  it('找得到 PATH 上的程序', () => {
    const { file, dir } = makeProgram()
    const name = path.basename(file)

    const found = findExecutable(name, { PATH: dir })

    expect(found).toBe(file)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('PATH 上没有就是没有，不是一个错误', () => {
    const { dir } = makeProgram()

    expect(findExecutable('definitely-not-installed', { PATH: dir })).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('把它跑起来，拿到它说的话和它的退出码', async () => {
    const { file, dir } = makeProgram()

    const result = await runCli(file, [])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('hello from the agent')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('程序不在了，也是一句话而不是一次崩溃', async () => {
    const result = await runCli(path.join(os.tmpdir(), 'not-a-program-at-all'), [])

    expect(result.code).toBeNull()
    expect(result.stderr.length).toBeGreaterThan(0)
  })
})

describe('读 JSONL', () => {
  it('空行不算，坏行也不算', () => {
    const records = jsonlLines('{"a":1}\n\n{"b":2}\n{not json}\n{"c":3}\n')

    expect(records).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  it('最后一行只写了一半，也不算', () => {
    expect(jsonlLines('{"a":1}\n{"b":')).toEqual([{ a: 1 }])
  })
})
