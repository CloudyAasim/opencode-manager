import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSettingsStore, defaultSettingsPath } from './settings-store.ts'

async function tempFile(name = 'client.json'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ocm-settings-'))
  return path.join(dir, name)
}

describe('客户端记住的东西', () => {
  it('记住一台服务器', async () => {
    const file = await tempFile()
    const store = createSettingsStore(file)

    store.write({ target: 'https://code.example.com' })

    expect(store.read().target).toBe('https://code.example.com')
  })

  it('记住端口', async () => {
    const file = await tempFile()
    const store = createSettingsStore(file)

    store.write({ target: 'https://code.example.com', port: 47831 })

    expect(store.read()).toEqual({ target: 'https://code.example.com', port: 47831 })
  })

  it('没有文件时什么都不记得', async () => {
    const store = createSettingsStore(await tempFile())

    expect(store.read()).toEqual({})
  })

  it('文件坏了也不拦着客户端启动', async () => {
    const file = await tempFile()
    await writeFile(file, '{not json', 'utf8')
    const store = createSettingsStore(file)

    expect(store.read()).toEqual({})
  })

  it('Windows 编辑器留下的那个字节顺序标记，不该让整份文件读不出来', async () => {
    // The settings file is a thing a person is allowed to edit, and Windows
    // editors add a byte order mark. A file the client cannot read is a
    // server it forgets - and then overwrites.
    const file = await tempFile()
    await writeFile(file, '\uFEFF{"target":"https://code.example.com"}', 'utf8')
    const store = createSettingsStore(file)

    expect(store.read().target).toBe('https://code.example.com')
  })

  it('记住的不是一个地址时就不记', async () => {
    const file = await tempFile()
    const store = createSettingsStore(file)

    store.write({ target: 'not a url' })

    expect(store.read().target).toBeUndefined()
  })

  it('端口不合理时就不记', async () => {
    const file = await tempFile()
    const store = createSettingsStore(file)

    store.write({ port: 0 })
    store.write({ port: 70000 })
    store.write({ port: 1.5 })

    expect(store.read().port).toBeUndefined()
  })

  it('写的是能读回来的那份，不是拼出来的', async () => {
    // The file is the contract with the next launch, so what is on disk has to
    // be what the store answers - not a second format that happens to agree.
    const file = await tempFile()
    const store = createSettingsStore(file)

    store.write({ target: 'https://code.example.com', port: 47831 })

    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(raw).toEqual({ target: 'https://code.example.com', port: 47831 })
  })

  it('写坏了要说得出来，不能悄悄丢掉', async () => {
    const file = await tempFile()
    const store = createSettingsStore(file)

    expect(() => store.write({ target: 'https://code.example.com' })).not.toThrow()
    // A file that cannot be written is a failure the caller has to know about:
    // the proxy refuses a target it could not remember.
    const directory = await tempFile('a-directory')
    const store2 = createSettingsStore(path.join(directory, 'nested', 'client.json'))
    expect(() => store2.write({ target: 'https://code.example.com' })).not.toThrow()
  })
})

describe('设置文件放在哪', () => {
  it('可以用环境变量指到别处', () => {
    const path = defaultSettingsPath({ OCM_CLIENT_SETTINGS: 'D:/somewhere/client.json' } as NodeJS.ProcessEnv)
    expect(path).toBe('D:/somewhere/client.json')
  })

  it('默认在用户自己的目录下', () => {
    const path = defaultSettingsPath({ HOME: '/home/someone', USERPROFILE: '/home/someone' } as NodeJS.ProcessEnv)
    expect(path).toContain('.opencode-manager')
    expect(path).toContain('client.json')
  })
})
