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

// One useMutation({ ... }) options object, located by brace matching. Splitting
// on the literal "useMutation({" instead lets the next mutation's body leak
// into this one, which quietly turns a real handler into a do-nothing one -
// two of the rules below would then go silent.
function mutationBlocks(text: string): string[] {
  const out: string[] = []
  for (const open of text.matchAll(/useMutation\(\{/g)) {
    let depth = 0
    for (let i = open.index + open[0].length - 1; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) {
          out.push(text.slice(open.index + open[0].length, i))
          break
        }
      }
    }
  }
  return out
}

const HANDLER = /\n[ \t]+(mutationFn|on[A-Z]\w*):/g
function handlersOf(block: string): Record<string, string> {
  const found = [...block.matchAll(HANDLER)].map((m) => [m[1]!, m.index!] as const)
  const out: Record<string, string> = {}
  for (let i = 0; i < found.length; i++) {
    const end = i + 1 < found.length ? found[i + 1]![1] : block.length
    out[found[i]![0]] = block.slice(found[i]![1], end)
  }
  return out
}

/** What follows `name:` - the whole expression, not just an arrow body. */
function exprOf(handler: string): string {
  const i = handler.indexOf(':')
  return (i === -1 ? handler : handler.slice(i + 1)).trim()
}

function arrowBody(handler: string): string {
  const expr = exprOf(handler)
  const braced = expr.match(/=>\s*\{/)
  if (!braced) {
    const bare = expr.match(/=>\s*([^\n,]*)/)
    return bare ? bare[1]!.trim() : ''
  }
  let depth = 0
  for (let i = braced.index! + braced[0].length - 1; i < expr.length; i++) {
    if (expr[i] === '{') depth++
    else if (expr[i] === '}') {
      depth--
      if (depth === 0) return expr.slice(braced.index! + braced[0].length, i).trim()
    }
  }
  return expr.slice(braced.index! + braced[0].length).trim()
}

/** "writes a query cache" - by whatever helper the file happens to use. */
const WRITES_CACHE = /setQueryData|setQueriesData|setRepoGitStatusCaches/
/** Stopping in-flight queries goes through the one helper that also swallows
 *  the cancellation, so a new optimistic write cannot pick the unsafe spelling. */
/** A step that stops in-flight queries, by whatever it is called. The spelling
 *  is not the point - the next rule is what makes it safe. */
const STOPS_QUERIES = /\b(cancel[A-Z]\w*|stop[A-Z]\w*)\s*\(/
/** A handler that runs but accomplishes nothing. `handleError` is real work. */
const DOES_NOTHING = /^\{?\s*(\/\/[^\n]*\s*|void 0\s*|return\s+void 0\s*)*\}?$/

interface Mutation {
  rel: string
  block: string
  onMutate: string
  onError: string
  writesLocally: boolean
}

function readMutation(rel: string, block: string): Mutation {
  const h = handlersOf(block)
  const onMutate = h.onMutate ?? ''
  const onError = h.onError ?? ''
  return {
    rel,
    block,
    onMutate,
    onError,
    writesLocally: WRITES_CACHE.test(arrowBody(onMutate)),
  }
}

const ALL_MUTATIONS = ALL_FILES.flatMap((rel) => mutationBlocks(read(rel)).map((b) => readMutation(rel, b)))
const LOCAL_WRITES = ALL_MUTATIONS.filter((m) => m.writesLocally)

/**
 * The keys onMutate hands to onError. Reading a key that was never returned
 * means the rollback is restoring nothing - and the word still appears in the
 * source, so a rule that only greps for it would call that fine.
 */
function snapshotKeys(m: Mutation): string[] {
  const returns = [...arrowBody(m.onMutate).matchAll(/return\s*\{([^}]*)\}/g)]
  const last = returns[returns.length - 1]
  if (!last) return []
  return last[1]!
    .split(',')
    .map((part) => part.split(':')[0]!.trim())
    .filter((key) => /^[A-Za-z_$][\w$]*$/.test(key))
}

function keysRestoredInError(m: Mutation): string[] {
  return [...m.onError.matchAll(/context(?:\?)?\.(\w+)/g)].map((hit) => hit[1]!)
}

/**
 * Staging a file, pinning a session: both are rearrangements of a list we are
 * already holding, so the list can move the instant you click and the server
 * can catch up afterwards. Before this it only moved once the response came
 * back - on a slow link that reads as "did that click land?", followed by
 * clicking again.
 *
 * The rules are about structure, not about which hook: any mutation that
 * writes a cache locally has to stop the in-flight refetch first and put the
 * list back if it fails. A local write without a rollback is worse than no
 * local write at all - the list is now lying and nothing will put it right.
 */
describe('列表型写操作先改本地', () => {
  it('门禁自己看得见东西', () => {
    expect(ALL_FILES.length, '源文件少得可疑，这门禁多半跑在空集上').toBeGreaterThan(300)
    expect(ALL_MUTATIONS.length, 'mutation 数量变了，门禁得跟着看').toBeGreaterThanOrEqual(50)
    const pathBlocks = mutationBlocks(read(USE_GIT)).filter((b) => /\bpaths:\s*string\[\]/.test(b))
    expect(pathBlocks.length, '按文件路径操作的 mutation 数量变了').toBe(3)
    expect(LOCAL_WRITES.length, '写本地缓存的 mutation 数量变了').toBeGreaterThanOrEqual(6)
    // the rule above points at this helper; if it stops swallowing the
    // rejection the rule is guarding nothing
    expect(read('lib/queryInvalidation.ts'), 'stopQueries 不再吞掉取消的拒绝，这条规则就悬空了')
      .toMatch(/cancelQueries\(filters\)\.catch\(\(\) => \{\}\)/)
    for (const [rel, why] of MUST_MOVE_THE_LIST_NOW) {
      expect(ALL_FILES.includes(rel), `找不到 ${rel}（${why}）`).toBe(true)
    }
    // the last rule hangs off this one; if the model stops deriving the flag
    // from a count, that rule is pointing at nothing
    expect(read(MODEL), '模型不再负责推算 hasChanges，这条规则就悬空了')
      .toMatch(/hasChanges\s*:\s*[^,\n}]*\.length\s*[><=]/)
  })

  it('凡是按文件路径操作的 mutation，都要先写本地再发请求', () => {
    const offenders = mutationBlocks(read(USE_GIT))
      .filter((block) => /\bpaths:\s*string\[\]/.test(block))
      .filter((block) => {
        const m = readMutation(USE_GIT, block)
        return !/withStagedPaths|withoutPaths/.test(arrowBody(m.onMutate))
      })
    expect(
      offenders,
      `这些 mutation 按文件路径操作却没有先写本地：\n${offenders.join('\n---\n')}`,
    ).toEqual([])
  })

  it('用户盯着列表动的那几处，不许退回"等服务端"', () => {
    // Which mutations *must* be optimistic cannot be derived - plenty of list
    // mutations genuinely are not, and a stage is. So the obligation is
    // declared here instead of left to be rediscovered as a bug report.
    const offenders = MUST_MOVE_THE_LIST_NOW
      .filter(([rel]) => !mutationBlocks(read(rel)).some((b) => readMutation(rel, b).writesLocally))
      .map(([rel, why]) => `${rel}（${why}）`)
    expect(offenders, '这些操作不再先动本地，用户点了却看不到反应').toEqual([])
  })

  it('写了本地缓存的 mutation：改之前先叫停在途 refetch', () => {
    const offenders = LOCAL_WRITES.filter((m) => !STOPS_QUERIES.test(arrowBody(m.onMutate))).map((m) => m.rel)
    expect(offenders, '这些 mutation 直接写本地，没先停住在途 refetch').toEqual([])
  })

  it('写了本地缓存的 mutation：失败时必须在 onError 里按原样放回去', () => {
    const offenders = LOCAL_WRITES.filter((m) => !WRITES_CACHE.test(exprOf(m.onError))).map((m) => m.rel)
    expect(offenders, '这些 mutation 改了本地缓存却没有在失败时放回去').toEqual([])
  })

  it('回滚读到的快照，必须真的是 onMutate 存进去的那个', () => {
    const offenders = LOCAL_WRITES
      .filter((m) => {
        const stored = snapshotKeys(m)
        const read = keysRestoredInError(m)
        return read.some((key) => !stored.includes(key))
      })
      .map((m) => m.rel)
    expect(
      offenders,
      '这些 mutation 在 onError 里读一个 onMutate 根本没存过的字段，等于什么都没还原',
    ).toEqual([])
  })

  it('不许有空转的 onError：失败了要让人知道', () => {
    // `onError: () => { void 0 }` is not "handle it quietly", it is "the user
    // clicks, nothing happens, and nothing says why". A bare reference like
    // `handleError` is real work and is not what this rule is about.
    const offenders = ALL_MUTATIONS
      .filter((m) => m.onError)
      .filter((m) => {
        const expr = exprOf(m.onError)
        if (!expr) return true
        if (!expr.includes('=>')) return false
        return DOES_NOTHING.test(arrowBody(m.onError))
      })
      .map((m) => m.rel)
    expect(offenders, '这些 mutation 把失败整个吞掉了').toEqual([])
  })

  it('cancelQueries 全应用只允许出现在 stopQueries 内部', () => {
    // cancelQueries rejects with CancelledError whenever it actually had a
    // query running. Awaited bare, a background refetch that happens to be in
    // flight at that instant aborts the whole mutation: the snapshot is never
    // taken and mutationFn never runs, so the click does nothing at all. The
    // cancellation is the outcome we wanted, so it is not an error.
    //
    // Scoped to the whole app rather than to onMutate, because a wrapper like
    // cancelRepoGitStatus is perfectly fine - what is not fine is any caller
    // that reaches the client directly and has to remember this on its own.
    const offenders = ALL_FILES
      .filter((rel) => rel !== 'lib/queryInvalidation.ts')
      .filter((rel) => /cancelQueries\s*\(/.test(read(rel)))
    expect(
      offenders,
      `cancelQueries 只能出现在 stopQueries 内部，这些地方是裸调用：${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('hasChanges 只在那一处从列表长度推算', () => {
    // Get it wrong and the commit box disappears the moment you stage your
    // first file, so it is derived in exactly one place. Reading somebody
    // else's flag is fine - only re-deriving it is not.
    const offenders = ALL_FILES
      .filter((rel) => rel !== MODEL)
      .filter((rel) => /hasChanges\s*:\s*[^,\n}]*\.length\s*[><=]/.test(read(rel)))
    expect(offenders, `hasChanges 在别处被重算了一遍：${offenders.join(', ')}`).toEqual([])
  })
})

/** [file, why the user is watching the list move] */
const MUST_MOVE_THE_LIST_NOW: ReadonlyArray<readonly [string, string]> = [
  [USE_GIT, '暂存把文件移过暂存线'],
  ['hooks/useSessionPins.ts', '置顶把会话移到列表最前'],
]
