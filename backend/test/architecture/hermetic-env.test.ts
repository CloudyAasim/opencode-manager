import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { childEnvFor } from '../../src/utils/child-env'
import { buildImportGraph, relativeTo } from '../helpers/import-graph'

const BACKEND_SRC = path.resolve(__dirname, '../../src')

const graph = buildImportGraph(BACKEND_SRC)
const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: fs.readFileSync(file, 'utf8'),
}))

/**
 * `git-errors.ts` recognises failures by matching git's English wording, so a
 * git child process has to be pinned to the C locale wherever it is spawned.
 * The first three bugs this repository carried out of a single Windows checkout
 * were all "the answer depends on the machine": git's language, whether an
 * `opencode` happens to be installed, which OpenCode version answers `--version`.
 *
 * This gate covers the first of those three. The rule below exists because the
 * obvious place to pin the locale - the one helper everything routes through -
 * is also the easiest to route around: a service that needs something the
 * helper does not do will reach for `child_process` directly, and nothing else
 * would notice.
 */
const DIRECT_GIT_SPAWN = /\b(?:spawn|spawnSync|execFileSync|execFile)\(\s*['"]git['"]/g

const HELPER_MODULE = 'utils/process.ts'

/**
 * The slice of source that is the spawn call itself, found by balancing
 * parentheses rather than by counting characters.
 *
 * Matching the whole file for `childEnvFor` looks equivalent and is not: the
 * file's own import statement carries the name, so deleting `env:
 * childEnvFor('git')` from the call while leaving the import in place keeps
 * the file matching, and the rule goes green over the exact thing it exists to
 * catch. The obligation belongs to the call, so the check has to read the call.
 */
function spawnCallAt(text: string, start: number): string {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return text.slice(start)
}

function unpinnedGitSpawnSites(): string[] {
  const offenders: string[] = []
  for (const source of SOURCES) {
    if (source.rel === HELPER_MODULE) continue
    for (const match of source.text.matchAll(DIRECT_GIT_SPAWN)) {
      const call = spawnCallAt(source.text, match.index ?? 0)
      if (!call.includes('childEnvFor')) offenders.push(`${source.rel}: ${match[0]}`)
    }
  }
  return offenders.sort()
}

function directGitSpawnCount(): number {
  let count = 0
  for (const source of SOURCES) {
    if (source.rel === HELPER_MODULE) continue
    count += [...source.text.matchAll(DIRECT_GIT_SPAWN)].length
  }
  return count
}

function render(title: string, offenders: string[]): string {
  if (offenders.length === 0) return `${title}: 0 处违规`
  return [
    `${title}: ${offenders.length} 处违规`,
    ...offenders.map((entry) => `  ${entry}`),
  ].join('\n')
}

describe('git 子进程的 locale 契约', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '一张空图上跑出来的门禁证明不了任何事').toBeGreaterThan(100)
    expect(
      directGitSpawnCount(),
      '一个直接 spawn git 的地方都没有，这条规则正在空跑',
    ).toBeGreaterThan(0)
  })

  it('命令自己带 git 时无视宿主的 locale', () => {
    const previous = process.env.LC_ALL
    process.env.LC_ALL = 'zh_CN.UTF-8'
    try {
      const env = childEnvFor('git')
      expect(env.LC_ALL, '宿主 locale 会漏进 git 子进程，git-errors.ts 的英文匹配就会全部失效').toBe('C')
      expect(env.LANG).toBe('C')
      expect(env.LANGUAGE).toBe('C')
    } finally {
      if (previous === undefined) delete process.env.LC_ALL
      else process.env.LC_ALL = previous
    }
  })

  it('调用方给的 env 不会被丢掉', () => {
    const env = childEnvFor('git', { GIT_TERMINAL_PROMPT: '0' })
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.LC_ALL).toBe('C')
  })

  it('不给 git 乱加 locale', () => {
    const env = childEnvFor('rg', { LC_ALL: 'zh_CN.UTF-8' })
    expect(env.LC_ALL, 'locale 是 git 专属的，不该改写别的命令').toBe('zh_CN.UTF-8')
  })

  it('直接 spawn git 的调用本身必须带 childEnvFor', () => {
    const offenders = unpinnedGitSpawnSites()
    expect(offenders, render('spawn 调用本身没有带 childEnvFor', offenders)).toEqual([])
  })
})
