import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const read = (rel: string) => fs.readFileSync(path.join(FRONTEND_SRC, rel), 'utf8')
const ALL_FILES = (function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path.relative(FRONTEND_SRC, full).split(path.sep).join('/'))
    }
  }
  return out
})(FRONTEND_SRC)

const USE_GIT = 'hooks/useGit.ts'
const MODEL = 'lib/gitStatus.ts'

// Split a file into one chunk per useMutation({ ... }) call. Everything this
// gate checks lives inside a single one of those.
function mutations(text: string): string[] {
  return text.split('useMutation({').slice(1)
}

/**
 * Staging a file is a rearrangement of a list we already hold, so the list can
 * move the instant you click and the server can catch up afterwards. Before
 * this, the list only moved once the response came back - on a slow link that
 * meant clicking a file and being unsure whether it worked.
 *
 * The rule covers mutations that take a list of file paths. Commit is
 * deliberately not one of them: committing produces a new commit, not a
 * rearrangement, and predicting that locally would be guessing.
 */
const TAKES_PATHS = /\bpaths:\s*string\[\]/

/** Just the body of one lifecycle handler, so a rule about rollback cannot be
 *  satisfied by the word "previous" appearing somewhere else in the mutation. */
function handler(block: string, name: string): string {
  const start = block.indexOf(`${name}:`)
  if (start === -1) return ''
  const rest = block.slice(start + name.length + 1)
  const next = rest.search(/\n {4}on[A-Z]/)
  return next === -1 ? rest : rest.slice(0, next)
}

/** Deriving the flag from a count. `hasChanges` on its own is a common word -
 *  scroll position, dirty editors - so the rule is about the derivation, not
 *  the name. */
const DERIVES_FROM_A_COUNT = /hasChanges\s*:\s*[^,\n}]*\.length\s*[><=]/

describe('列表型写操作先改本地', () => {
  it('门禁自己看得见东西', () => {
    expect(ALL_FILES.length, '源文件少得可疑，这门禁多半跑在空集上').toBeGreaterThan(300)
    const blocks = mutations(read(USE_GIT))
    expect(blocks.length, 'useGit 里的 mutation 数量变了，门禁得跟着看').toBeGreaterThanOrEqual(10)
    expect(
      blocks.filter((block) => TAKES_PATHS.test(block)).length,
      '按文件路径操作的 mutation 数量变了',
    ).toBe(3)
    // the rule below hangs off this one; if it stops deriving the flag from a
    // count the whole rule is pointing at nothing
    expect(read(MODEL), '模型不再负责推算 hasChanges，这条规则就悬空了').toMatch(DERIVES_FROM_A_COUNT)
  })

  it('凡是按文件路径操作的 mutation，都要先写本地再发请求', () => {
    const offenders = mutations(read(USE_GIT))
      .filter((block) => TAKES_PATHS.test(block))
      .filter((block) => !/onMutate:/.test(block) || !/withStagedPaths|withoutPaths/.test(block))
    expect(
      offenders,
      `这些 mutation 按文件路径操作却没有先写本地：\n${offenders.join('\n---\n')}`,
    ).toEqual([])
  })

  it('先写本地的必须留后路：失败时按原样放回去', () => {
    // A local write with no rollback is worse than no local write at all: the
    // list is now lying and nothing will ever put it right. The rollback has
    // to be *in the error handler* - onMutate mentioning `previous` is not a
    // rollback, it is just the name of the thing we failed to restore.
    const offenders = mutations(read(USE_GIT))
      .filter((block) => /onMutate:/.test(block))
      .filter((block) => {
        const onError = handler(block, 'onError')
        return !/context/.test(onError) || !/previous/.test(onError)
      })
    expect(
      offenders,
      `这些 mutation 改了本地缓存却没有在失败时放回去：\n${offenders.join('\n---\n')}`,
    ).toEqual([])
  })

  it('改本地之前先叫停在途的 refetch，否则它会盖掉本地结果', () => {
    const offenders = mutations(read(USE_GIT))
      .filter((block) => /onMutate:/.test(block))
      .filter((block) => !/cancelRepoGitStatus/.test(block))
    expect(
      offenders,
      `这些 mutation 直接写本地，没先取消在途 refetch：\n${offenders.join('\n---\n')}`,
    ).toEqual([])
  })

  it('hasChanges 只在那一处从列表长度推算', () => {
    // Get it wrong and the commit box disappears the moment you stage your
    // first file, so it is derived in exactly one place. Reading somebody
    // else's flag is fine - only re-deriving it is not.
    const offenders = ALL_FILES.filter((rel) => rel !== MODEL).filter((rel) =>
      DERIVES_FROM_A_COUNT.test(read(rel)),
    )
    expect(
      offenders,
      `hasChanges 在别处被重算了一遍：${offenders.join(', ')}`,
    ).toEqual([])
  })
})
