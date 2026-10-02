import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const API_SRC = path.join(FRONTEND_SRC, 'api')
const read = (rel: string) => fs.readFileSync(path.join(FRONTEND_SRC, rel), 'utf8')
const API_FILES = fs
  .readdirSync(API_SRC)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => `api/${name}`)

const BUDGETS = read('api/timeouts.ts')

/** The options object of the call that mentions `route`, found by brace
 *  matching so a route named in a comment or a neighbouring call cannot
 *  satisfy the rule for the wrong request. The opening paren is the one
 *  *before* the route - these are template literals, so the call reads
 *  fetchWrapper(`${API_BASE_URL}/api/repos`, { ... }). */
function callOptionsFor(route: string): { rel: string; body: string } | null {
  for (const rel of API_FILES) {
    const text = read(rel)
    let from = 0
    for (;;) {
      const at = text.indexOf(route, from)
      if (at === -1) break
      from = at + route.length
      // the route has to end there: "/api/repos" is a prefix of
      // "/api/repos/discover" and half a dozen more
      if (text[from] !== '`') continue
      const open = text.lastIndexOf('(', at)
      if (open === -1 || at - open > 80) continue
      let depth = 0
      for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth++
        else if (text[i] === ')') {
          depth--
          if (depth === 0) return { rel, body: text.slice(open, i + 1) }
        }
      }
    }
  }
  return null
}

const declaredRoutes = [...BUDGETS.matchAll(/\['([^']+)',\s*'(\w+)'\]/g)].map((m) => ({
  route: m[1]!,
  key: m[2]!,
}))

/**
 * The browser was giving up at 45s on a request the server allows five
 * minutes for. That is not a faster failure - the clone lands anyway and the
 * user is told it did not. So the routes whose handler runs one of the slow
 * operations carry a budget derived from the server's own, and this gate keeps
 * the two ends from drifting apart.
 *
 * The list is declared, not inferred: the frontend cannot see the server's
 * budget from here, and a rule that guessed which routes are slow would be a
 * rule that guessed wrong.
 */
describe('慢请求的客户端预算不许短于服务端', () => {
  it('门禁自己看得见东西', () => {
    expect(API_FILES.length, 'api 目录读不到东西').toBeGreaterThan(5)
    expect(declaredRoutes.length, '声明的慢路由数量变了').toBeGreaterThanOrEqual(3)
    for (const key of ['clone', 'versionInstall', 'openCodeUpgrade']) {
      expect(BUDGETS, `REQUEST_TIMEOUTS 少了 ${key}`).toContain(`${key}:`)
    }
    // every declared budget must be longer than the built-in one, or the whole
    // point of declaring it is lost
    const declared = [...BUDGETS.matchAll(/^\s{2}(\w+):\s*([\d_]+),/gm)].map((m) => Number(m[2]!.replace(/_/g, '')))
    expect(declared.length, 'REQUEST_TIMEOUTS 解析不到任何数值').toBe(declaredRoutes.length)
    for (const ms of declared) {
      expect(ms, `预算 ${ms}ms 没有比默认的 45s 长`).toBeGreaterThan(45_000)
    }
  })

  it('声明的每条慢路由，都在自己的调用里带上了对应的预算', () => {
    const offenders = declaredRoutes
      .filter(({ route, key }) => {
        const call = callOptionsFor(route)
        return !call || !call.body.includes(`REQUEST_TIMEOUTS.${key}`)
      })
      .map(({ route, key }) => `${route} 缺 timeout: REQUEST_TIMEOUTS.${key}`)
    expect(offenders, `这些慢路由还在用默认的 45s：\n${offenders.join('\n')}`).toEqual([])
  })

  it('预算写在 REQUEST_TIMEOUTS 里，不散落成魔法数字', () => {
    // a literal in a call means someone tuned one request and left the reason
    // in a diff nobody reads next year
    const offenders = API_FILES
      .filter((rel) => /timeout:\s*[\d_]{4,}/.test(read(rel)))
      .map((rel) => rel)
    expect(offenders, `这些文件里写着字面量超时：${offenders.join(', ')}`).toEqual([])
  })
})
