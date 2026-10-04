import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * The assistant's directory is a sibling of the projects directory, so the file
 * browser's root cannot reach it and the user had no way to see what was in it
 * or reclaim the space. These tests use the real filesystem because the whole
 * claim is about sizes and about what the walk is willing to follow.
 */

const envRef = { settingDir: '' }

vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opencode-manager/shared/config/env')>()
  return { ...actual, getUserSettingPath: () => envRef.settingDir }
})

import { listAssistantWorkspaceContents } from '../../src/services/assistant-mode/service'

function writeFileWithSize(target: string, bytes: number): void {
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, Buffer.alloc(bytes, 'a'))
}

describe('listAssistantWorkspaceContents', () => {
  let tmpRoot: string
  let assistantDir: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'ocm-assistant-workspace-'))
    assistantDir = path.join(tmpRoot, 'setting', 'assistant')
    envRef.settingDir = path.join(tmpRoot, 'setting')
    mkdirSync(assistantDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('returns an empty listing when the assistant has never been initialised', async () => {
    // A fresh account has no assistant directory. That is a normal state, and
    // it must not turn into a 500 on a settings panel.
    rmSync(assistantDir, { recursive: true, force: true })
    expect(existsSync(assistantDir)).toBe(false)

    const result = await listAssistantWorkspaceContents('aasim')

    expect(result.entries).toEqual([])
    expect(result.totalSizeBytes).toBe(0)
    expect(result.truncated).toBe(false)
  })

  it('lists what is there and adds up the sizes', async () => {
    writeFileWithSize(path.join(assistantDir, 'opencode.json'), 100)
    writeFileWithSize(path.join(assistantDir, 'AGENTS.md'), 200)
    writeFileWithSize(path.join(assistantDir, 'RelayAB', 'README.md'), 400)
    writeFileWithSize(path.join(assistantDir, 'RelayAB', 'src', 'index.ts'), 600)

    const result = await listAssistantWorkspaceContents('aasim')

    const byName = new Map(result.entries.map((entry) => [entry.name, entry]))
    expect(byName.get('AGENTS.md')?.sizeBytes).toBe(200)
    expect(byName.get('opencode.json')?.sizeBytes).toBe(100)
    // A directory is the sum of the files inside it, at any depth.
    expect(byName.get('RelayAB')?.isDirectory).toBe(true)
    expect(byName.get('RelayAB')?.sizeBytes).toBe(1000)
    expect(result.totalSizeBytes).toBe(1300)
    expect(result.truncated).toBe(false)
  })

  it('marks the entries the app writes, so deleting one reads differently', async () => {
    writeFileWithSize(path.join(assistantDir, 'AGENTS.md'), 10)
    writeFileWithSize(path.join(assistantDir, 'opencode.json'), 10)
    writeFileWithSize(path.join(assistantDir, '.opencode', 'agents', 'assistant.md'), 10)
    writeFileWithSize(path.join(assistantDir, 'cloned-in-here', 'README.md'), 10)

    const result = await listAssistantWorkspaceContents('aasim')
    const byName = new Map(result.entries.map((entry) => [entry.name, entry]))

    expect(byName.get('AGENTS.md')?.isManaged).toBe(true)
    expect(byName.get('opencode.json')?.isManaged).toBe(true)
    expect(byName.get('.opencode')?.isManaged).toBe(true)
    // The whole point of the panel: a repository that turned up in the wrong
    // directory is not app-managed, so deleting it is an ordinary action.
    expect(byName.get('cloned-in-here')?.isManaged).toBe(false)
  })

  it('reports a symlink as zero rather than measuring what it points at', async () => {
    // A link to a directory is the dangerous shape: the walk would add up a
    // tree that lives outside this directory, and could walk back out of the
    // tree it started in. `withFileTypes` reports it as a symlink rather than a
    // directory, so the walk never descends into it - and the reported size is
    // the link's own, which is zero.
    const outside = path.join(tmpRoot, 'outside')
    writeFileWithSize(path.join(outside, 'big.bin'), 5_000)
    symlinkSync(outside, path.join(assistantDir, 'link'))

    const result = await listAssistantWorkspaceContents('aasim')
    const link = result.entries.find((entry) => entry.name === 'link')

    expect(link?.sizeBytes).toBe(0)
    expect(result.totalSizeBytes).toBe(0)
  })

  it('skips an unreadable directory instead of failing the whole listing', async () => {
    writeFileWithSize(path.join(assistantDir, 'AGENTS.md'), 50)
    // A file where a directory would be walked: readdir fails on it.
    writeFileWithSize(path.join(assistantDir, 'not-a-dir', 'nested'), 10)

    const result = await listAssistantWorkspaceContents('aasim')

    expect(result.entries.map((entry) => entry.name).sort()).toEqual(['AGENTS.md', 'not-a-dir'])
  })
})
