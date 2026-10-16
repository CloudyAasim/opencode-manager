import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../helpers/repo-root'

const ROUTES_DIR = path.join(repoRoot, 'backend/src/routes')
const OWNER_HELPER = 'settings-owner.ts'

function routeFiles(dir = ROUTES_DIR): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...routeFiles(full))
      continue
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

/**
 * Who a request acts as must come from the session, never from the request.
 *
 * This is the third time this exact hole has been found in this repository. The
 * first two are written down in `auth/settings-owner.ts`: TTS and STT took their
 * id from `?userId=`, which turned a filter into a *selector* - any
 * authenticated user could name any tenant. It also split one setting in half,
 * because the write went to the session user while the read went to whichever
 * tenant the client asked for, so enabling TTS in the panel produced a setting
 * nothing could hear.
 *
 * The third survived in `routes/notifications.ts`, five call sites, unnoticed
 * because those routes sit under `protectedApi` and therefore *look* guarded:
 * the guard is real, it just answers a different question - "is this a logged-in
 * user" rather than "is this user acting as themselves".
 *
 * So the rule below is about the shape of the mistake, not about one file. A
 * route is allowed to read a query string for a repo id, a page, a refresh flag
 * or a session id; it is not allowed to read an *identity* out of one.
 */
describe('身份只能来自会话，不能来自查询串', () => {
  const files = routeFiles()

  it('门禁自己看得见东西', () => {
    expect(files.length, '没扫到任何路由文件，这条门禁正在空跑').toBeGreaterThan(20)
  })

  it('没有任何面向用户的路由从查询串里取身份', () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = path.relative(ROUTES_DIR, file)
      // `internal/` authenticates with an internal token rather than a user
      // session, so its caller is a service, not a person. It is a different
      // trust model and deliberately not covered here.
      if (rel.startsWith(`internal${path.sep}`)) continue
      if (path.basename(file) === OWNER_HELPER) continue
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(/req\.query\(\s*['"](\w+)['"]\s*\)/g)) {
        const key = match[1]!
        if (!/^(user|owner|tenant|account|userId|ownerId)$/i.test(key)) continue
        offenders.push(`${rel}: c.req.query('${key}')`)
      }
    }
    expect(
      offenders,
      [
        `这些路由从查询串里取身份，共 ${offenders.length} 处：`,
        ...offenders,
        '身份必须来自会话。写成查询串，它就不是过滤器而是选择器——',
        '任何已登录用户都能指名任意租户，而这层守卫看不出来，因为它答的是',
        '"是不是登录用户"，不是"这个用户是不是他自己"。',
        '请改用 auth/settings-owner.ts 的 settingsOwnerId(c)。',
      ].join('\n'),
    ).toEqual([])
  })
})
