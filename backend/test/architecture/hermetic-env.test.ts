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
const DIRECT_GIT_SPAWN = /\b(?:spawn|spawnSync|execFileSync|execFile)\(\s*['"]git['"]/
const USES_HELPER = /\bchildEnvFor\b/

const HELPER_MODULE = 'utils/process.ts'

const DIRECT_SPAWN_SITES = SOURCES.filter((source) => source.rel !== HELPER_MODULE)
  .filter((source) => DIRECT_GIT_SPAWN.test(source.text))

function unpinnedGitSpawnSites(): string[] {
  return DIRECT_SPAWN_SITES
    .filter((source) => !USES_HELPER.test(source.text))
    .map((source) => source.rel)
    .sort()
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
      DIRECT_SPAWN_SITES.length,
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

  it('直接 spawn git 的地方必须经过 childEnvFor', () => {
    const offenders = unpinnedGitSpawnSites()
    expect(offenders, render('绕过 childEnvFor 直接 spawn git', offenders)).toEqual([])
  })
})
