import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepoRoutes } from '../../src/routes/repos'
import { createScheduleRoutes } from '../../src/routes/schedules'
import { createInternalRepoRoutes } from '../../src/routes/internal/repos'
import { createSessionPinRoutes } from '../../src/routes/session-pins'
import { createPromptTemplateRoutes } from '../../src/routes/prompt-templates'
import { createAuditRoutes } from '../../src/routes/admin-audit'
import { createRepo } from '../../src/db/queries'
import { SettingsService } from '../../src/services/settings'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { repoRoot } from '../helpers/repo-root'
import type { GitAuthService } from '../../src/services/git-auth'

/**
 * The authorization matrix, written down once.
 *
 * A project belongs to the account that created it. That is the whole rule,
 * and it holds for every role - including the administrator, who runs the
 * *server* (accounts, the audit log, the OpenCode process, the terminal) and
 * not other people's working copies.
 *
 * It used to hold for everybody except the administrator. `canAccessRepoOwner`
 * answered "yes" for an administrator whatever the owner was, and the top
 * bar's project switcher is made of `GET /api/repos` - so the dropdown listed
 * every account's every project. Two accounts with a checkout of the same
 * name then produced two identical entries, so it read less like "the
 * administrator sees too much" and more like "this list is everybody's".
 *
 * Two things are therefore pinned here, and they are pinned separately on
 * purpose:
 *
 * - the **structure**: no file that decides project access may widen it by
 *   role. That is the shape of the mistake, and it is what comes back.
 * - the **behaviour**: every tenant-scoped resource, asked by four different
 *   callers, and the answer each of them gets.
 *
 * The behaviour half is the "full privilege-escalation test" this file is:
 * one table, every row exercised by everybody, so a new surface has to be
 * written into the table rather than remembered.
 */

const SRC_DIR = path.join(repoRoot, 'backend/src')

/**
 * The ownership helpers that decide whether a *project* is reachable.
 *
 * These are the ones that must never widen by role. `canAccessOwner` - the
 * prompt-template rule, where the administrator does read everybody's copies -
 * is deliberately not in this list, and the two functions used to be written
 * identically, which is how the exception leaked from one into the other.
 */
const PROJECT_OWNERSHIP_HELPERS = [
  'canAccessRepoOwner',
  'canAccessRepo',
  'accessibleRepoIds',
  'accessibleRepoOwnerPaths',
  'resolveTenantAccessRoots',
]

/** Every way a file can say "this one is the administrator". */
const ADMIN_SHORTCUT_PATTERNS = [
  /role\s*===\s*['"]admin['"]/g,
  /principalIsAdmin\s*\(/g,
  /['"]admin['"]\s*===\s*\w+\.role/g,
]

function sourceFiles(dir = SRC_DIR): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full))
      continue
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

/** The admin shortcuts in a piece of source. */
function findAdminShortcuts(source: string): string[] {
  const found: string[] = []
  for (const pattern of ADMIN_SHORTCUT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      found.push(match[0])
    }
  }
  return found
}

/**
 * The body of one exported function, by brace matching.
 *
 * Shape rather than an exact string, because a gate that pins the exact text
 * of a function breaks the next time somebody reorders a line - and then it
 * stops being a gate and becomes a tripwire.
 */
function functionBody(source: string, name: string): string | null {
  const start = source.indexOf(`export function ${name}(`)
  if (start === -1) return null
  const open = source.indexOf('{', start)
  if (open === -1) return null
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }
  return null
}

describe('授权矩阵：结构上，项目这一层不得按角色放行', () => {
  const files = sourceFiles()

  it('门禁自己看得见东西', () => {
    // Two things have to hold before the rules below mean anything: the scan
    // has to find the backend, and the detector has to recognise a shortcut
    // when one is handed to it. A gate that cannot fail is not a gate.
    expect(files.length, '没扫到任何后端源文件，这条门禁正在空跑').toBeGreaterThan(50)

    expect(
      findAdminShortcuts("if (principal.role === 'admin') return true"),
      '检测器认不出内联的快捷方式样本',
    ).not.toEqual([])
    expect(
      findAdminShortcuts('return ownerId === principal.id'),
      '检测器把干净的代码也报成快捷方式',
    ).toEqual([])
  })

  it('归属判定的项目族函数里没有管理员捷径', () => {
    const source = fs.readFileSync(path.join(SRC_DIR, 'auth/ownership.ts'), 'utf8')
    const offenders: string[] = []

    for (const helper of PROJECT_OWNERSHIP_HELPERS) {
      const body = functionBody(source, helper)
      expect(body, `找不到 ${helper} 的函数体，这条门禁读不到它`).not.toBeNull()
      const shortcuts = findAdminShortcuts(body ?? '')
      if (shortcuts.length > 0) offenders.push(`${helper}: ${shortcuts.join(', ')}`)
    }

    expect(
      offenders,
      [
        '这些决定"项目归谁"的函数里出现了管理员捷径：',
        ...offenders,
        '管理员管的是服务器（账号、审计、OpenCode 进程、终端），不是别人目录里的工作副本。',
        '项目是租户资源，管理员也一样。提示词模板那种"共享库"规则请用 canAccessOwner，',
        '那才是管理员可以全看的东西——正因为当初这两个函数写得一模一样，',
        '例外才从一个漏到了另一个。',
      ].join('\n'),
    ).toEqual([])
  })

  it('用到项目归属判定的文件都不按角色放行', () => {
    const offenders: string[] = []
    let touched = 0

    for (const file of files) {
      // The file that *defines* the helpers is not a caller of them, and it
      // does carry the administrator shortcut - for the prompt templates,
      // which is a shared library rather than somebody's work. That one is
      // checked above, function by function.
      if (file === path.join(SRC_DIR, 'auth/ownership.ts')) continue

      const source = fs.readFileSync(file, 'utf8')
      const usesProjectHelper = PROJECT_OWNERSHIP_HELPERS.some((helper) =>
        new RegExp(`\\b${helper}\\b`).test(source),
      )
      if (!usesProjectHelper) continue
      touched += 1

      const shortcuts = findAdminShortcuts(source)
      if (shortcuts.length > 0) {
        offenders.push(`${path.relative(repoRoot, file)}: ${shortcuts.join(', ')}`)
      }
    }

    expect(touched, '没找到任何用到项目归属判定的文件，这条门禁正在空跑').toBeGreaterThan(3)
    expect(
      offenders,
      [
        '这些文件决定项目归谁，却按角色放行了：',
        ...offenders,
        '管理员的项目列表是管理员自己的项目列表。',
        '（服务器侧的能力——账号、审计、终端、服务商配置——走另一条路，不在这里。）',
      ].join('\n'),
    ).toEqual([])
  })
})

type Caller = { id: string; role: 'admin' | 'user'; username: string | null }

const ALICE: Caller = { id: 'u-alice', role: 'user', username: 'alice' }
const BOB: Caller = { id: 'u-bob', role: 'user', username: 'bob' }
const ADMIN: Caller = { id: 'u-root', role: 'admin', username: 'root' }

const STUB_GIT_AUTH = {
  getGitEnvironment: () => ({}),
  getGitCredentials: async () => [],
} as unknown as GitAuthService

/**
 * The fixture.
 *
 * Four projects: one per tenant, plus the shared one. The shared row is how
 * the Assistant repository is stored, and it is the only thing that should
 * ever be ownerless - a user project that lost its owner would come back
 * into every account's list at once.
 */
const FIXTURE = {
  alice: 1,
  bob: 2,
  shared: 3,
  admin: 4,
} as const

interface Harness {
  app: (caller: Caller | null) => Hono
  db: Database
  cleanup: () => void
}

/**
 * The checkouts, made once.
 *
 * Real repositories, so the git family can be asked about the same fixture as
 * everything else: a directory that is not a repository answers 500 rather
 * than 200, and that would make the row about the guard indistinguishable
 * from a row about git.
 *
 * They live under `users/`, not `repos/`, so the delete row's `rm -rf` -
 * which resolves against the repositories directory - finds nothing there
 * and the fixture survives the row that is about deleting it.
 */
let workspaceRoot = ''
const CHECKOUTS: Record<string, string> = {}

/** The checkout of one fixture project. Throws rather than answering undefined. */
function checkout(localPath: string): string {
  const dir = CHECKOUTS[localPath]
  if (!dir) throw new Error(`fixture has no checkout for ${localPath}`)
  return dir
}

function makeCheckout(localPath: string): string {
  const dir = path.join(workspaceRoot, 'users', localPath)
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q', dir], { stdio: 'ignore' })
  execFileSync(
    'git',
    ['-C', dir, '-c', 'user.email=test@example.test', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'init'],
    { stdio: 'ignore' },
  )
  return dir
}

// One workspace for the whole file, set up before any describe runs.
//
// It has to be here rather than inside a describe: the suites are shuffled,
// and a describe whose `beforeAll` had not run yet would build its fixtures
// against an empty workspace path - which is a *relative* path, and so wrote
// them into the working directory instead of the temporary tree.
beforeAll(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-authz-'))
  for (const localPath of ['alice-project', 'bob-project', 'assistant', 'admin-project']) {
    CHECKOUTS[localPath] = makeCheckout(localPath)
  }
})

afterAll(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
})

const STUB_SCHEDULE_SERVICE = {
  listJobs: () => [],
  createSchedule: () => {},
  getScheduleById: () => null,
  listSchedules: () => [],
  updateSchedule: () => {},
  deleteSchedule: () => {},
  prepareRepoDelete: () => {},
  listAllJobsWithRepos: () => [
    { id: 1, repoId: FIXTURE.alice, name: 'alice job' },
    { id: 2, repoId: FIXTURE.bob, name: 'bob job' },
    { id: 3, repoId: FIXTURE.shared, name: 'shared job' },
    { id: 4, repoId: FIXTURE.admin, name: 'admin job' },
  ],
  listAllRuns: () => [],
  listRuns: () => [],
  getJob: () => null,
  updateJob: () => null,
  deleteJob: () => null,
  runJob: () => null,
  cancelRun: () => null,
  clearRunHistory: () => null,
  deleteRun: () => null,
  listAllEnabledJobs: () => [],
  recoverRunningJobs: () => {},
  setJobChangeHandler: () => {},
} as never

function createHarness(): Harness {
  const previousWorkspacePath = process.env.WORKSPACE_PATH
  process.env.WORKSPACE_PATH = workspaceRoot

  const db = new Database(':memory:')
  migrate(db, allMigrations)

  const addRepo = (id: number, userId: string | null, localPath: string) =>
    createRepo(db, {
      localPath,
      sourcePath: checkout(localPath),
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
      userId,
    })

  addRepo(FIXTURE.alice, ALICE.id, 'alice-project')
  addRepo(FIXTURE.bob, BOB.id, 'bob-project')
  addRepo(FIXTURE.shared, null, 'assistant')
  addRepo(FIXTURE.admin, ADMIN.id, 'admin-project')

  // The other two tenant-owned tables, so the matrix has something to say
  // about them too.
  db.prepare(
    'INSERT INTO session_pins (session_id, directory, pinned_at, user_id) VALUES (?, ?, ?, ?)',
  ).run('ses_alice', '/users/alice/session-a', 1, ALICE.id)
  db.prepare(
    'INSERT INTO session_pins (session_id, directory, pinned_at, user_id) VALUES (?, ?, ?, ?)',
  ).run('ses_bob', '/users/bob/session-b', 2, BOB.id)
  db.prepare(
    'INSERT INTO session_pins (session_id, directory, pinned_at, user_id) VALUES (?, ?, ?, ?)',
  ).run('ses_admin', '/users/admin/session-c', 3, ADMIN.id)

  const addTemplate = (title: string, userId: string | null) =>
    db.prepare(
      `INSERT INTO prompt_templates (title, category, cadence_hint, suggested_name, suggested_description, description, prompt, created_at, updated_at, user_id)
       VALUES (?, 'test', 'daily', ?, '', '', 'prompt', ?, ?, ?)`,
    ).run(title, title, Date.now(), Date.now(), userId)

  addTemplate('alice-template', ALICE.id)
  addTemplate('bob-template', BOB.id)
  addTemplate('admin-template', ADMIN.id)

  const scheduleService = STUB_SCHEDULE_SERVICE

  const build = (caller: Caller | null): Hono => {
    const app = new Hono()
    // The session middleware the product mounts in front of every one of
    // these routes. A request with no session never reaches a handler in the
    // product, and the matrix says so rather than leaving it to be assumed.
    app.use('*', async (c, next) => {
      if (caller) {
        ;(c as unknown as { set: (key: string, value: unknown) => void }).set('user', caller)
      }
      await next()
    })
    app.use('*', async (c, next) => {
      if (!caller) return c.json({ error: 'Unauthorized' }, 401)
      await next()
    })
    app.route(
      '/repos',
      createRepoRoutes(
        db,
        STUB_GIT_AUTH,
        scheduleService,
        createStubOpenCodeClient({ getJson: (async () => []) as never }),
      ),
    )
    app.route('/schedules', createScheduleRoutes(scheduleService, db))
    app.route('/internal/repos', createInternalRepoRoutes(db, new SettingsService(db)))
    app.route('/session-pins', createSessionPinRoutes(db))
    app.route('/prompt-templates', createPromptTemplateRoutes(db))
    app.route('/admin/audit', createAuditRoutes(db))
    return app
  }

  return {
    app: build,
    db,
    cleanup: () => {
      db.close()
      if (previousWorkspacePath === undefined) {
        delete process.env.WORKSPACE_PATH
      } else {
        process.env.WORKSPACE_PATH = previousWorkspacePath
      }
    },
  }
}

interface ResourceRow {
  /** 资源名，失败时用 */
  resource: string
  method: string
  /** 指向 bob 的项目（id 2）——矩阵问的是"别人的项目" */
  path: string
  body?: unknown
}

/**
 * Every tenant-scoped surface of the project family, asked about somebody
 * else's project.
 *
 * The statuses are the ones the product answers with, and they are checked
 * per caller rather than per resource: the owner gets 200, a stranger gets
 * 404, and the administrator gets 404 as well - because a project is not a
 * server resource.
 *
 * 404 rather than 403 is deliberate and was already the rule: answering 403
 * when the row exists and 404 when it does not turns the status code into an
 * oracle, and a stranger could sweep ids and learn which projects exist.
 */
const CROSS_TENANT_RESOURCES: ResourceRow[] = [
  { resource: '项目详情', method: 'GET', path: `/repos/${FIXTURE.bob}` },
  { resource: '项目的 git 状态', method: 'GET', path: `/repos/${FIXTURE.bob}/git/status` },
  { resource: '项目的排程', method: 'GET', path: `/repos/${FIXTURE.bob}/schedules` },
  { resource: '项目的兄弟项目', method: 'GET', path: `/repos/${FIXTURE.bob}/siblings` },
  { resource: '项目改名', method: 'PATCH', path: `/repos/${FIXTURE.bob}`, body: { name: 'renamed' } },
  { resource: '项目删除', method: 'DELETE', path: `/repos/${FIXTURE.bob}` },
  { resource: '项目访问记录', method: 'POST', path: `/repos/${FIXTURE.bob}/access` },
]

describe('授权矩阵：行为上，每个人只看自己的项目', () => {
  for (const row of CROSS_TENANT_RESOURCES) {
    it(`${row.resource}：主人打得开，别人和管理员都打不开`, async () => {
      const harness = createHarness()
      try {
        const request = (caller: Caller | null) =>
          harness.app(caller).request(row.path, {
            method: row.method,
            headers: row.body ? { 'Content-Type': 'application/json' } : undefined,
            body: row.body ? JSON.stringify(row.body) : undefined,
          })

        const owner = await request(BOB)
        expect(owner.status, `项目主人自己打不开自己的${row.resource}`).toBe(200)

        const stranger = await request(ALICE)
        expect(stranger.status, `别人打开了${row.resource}`).toBe(404)

        const administrator = await request(ADMIN)
        expect(administrator.status, `管理员打开了别人的${row.resource}`).toBe(404)

        const anonymous = await request(null)
        expect(anonymous.status, `没登录的人打开了${row.resource}`).toBe(401)
      } finally {
        harness.cleanup()
      }
    })
  }

  it('共享的项目对所有人开放', async () => {
    const harness = createHarness()
    try {
      for (const caller of [ALICE, BOB, ADMIN]) {
        const response = await harness.app(caller).request(`/repos/${FIXTURE.shared}`)
        expect(response.status, `${caller.username} 打不开共享项目`).toBe(200)
      }
    } finally {
      harness.cleanup()
    }
  })

  it('项目列表里只有自己的和共享的', async () => {
    const harness = createHarness()
    try {
      const seen = async (caller: Caller) => {
        const response = await harness.app(caller).request('/repos')
        expect(response.status).toBe(200)
        const repos = (await response.json()) as Array<{ id: number }>
        return repos.map((repo) => repo.id).sort((left, right) => left - right)
      }

      // The dropdown in the top bar is made of exactly this list.
      expect(await seen(ALICE), '别人的项目出现在我的项目列表里').toEqual([FIXTURE.alice, FIXTURE.shared])
      expect(await seen(BOB), '别人的项目出现在我的项目列表里').toEqual([FIXTURE.bob, FIXTURE.shared])
      expect(await seen(ADMIN), '管理员的项目列表里有别人的项目').toEqual([FIXTURE.shared, FIXTURE.admin])
    } finally {
      harness.cleanup()
    }
  })

  it('管理员的租户范围里没有别人的项目目录', async () => {
    // The scope the project surface measures paths against. It is the
    // administrator's *account* reach, not their server reach: the whole
    // workspace is still theirs in the file browser.
    const { resolveTenantAccessRoots } = await import('../../src/auth/ownership')
    const { isWithinRoots } = await import('../../src/auth/access-scope')
    const harness = createHarness()
    try {
      const roots = resolveTenantAccessRoots(harness.db, ADMIN)

      expect(
        isWithinRoots(checkout('bob-project'), roots),
        '管理员的租户范围里出现了别人的项目目录',
      ).toBe(false)
      expect(
        isWithinRoots(checkout('admin-project'), roots),
        '管理员的租户范围里没有自己的项目目录',
      ).toBe(true)
    } finally {
      harness.cleanup()
    }
  })

  it('跨项目的排程列表只列自己的', async () => {
    const harness = createHarness()
    try {
      const jobs = async (caller: Caller) => {
        const response = await harness.app(caller).request('/schedules/all')
        expect(response.status).toBe(200)
        const body = (await response.json()) as { jobs: Array<{ id: number }> }
        return body.jobs.map((job) => job.id).sort((left, right) => left - right)
      }

      expect(await jobs(ALICE)).toEqual([1, 3])
      expect(await jobs(BOB)).toEqual([2, 3])
      expect(await jobs(ADMIN), '管理员看到了别人的排程').toEqual([3, 4])
    } finally {
      harness.cleanup()
    }
  })

  it('内部仓库列表只列自己的', async () => {
    // The OpenCode plugin reads this one on every tool call, so it is the
    // list that ends up in an agent's context.
    const harness = createHarness()
    try {
      const repos = async (caller: Caller) => {
        const response = await harness.app(caller).request('/internal/repos')
        expect(response.status).toBe(200)
        const body = (await response.json()) as { repos: Array<{ id: number }> }
        return body.repos.map((repo) => repo.id).sort((left, right) => left - right)
      }

      expect(await repos(ALICE)).toEqual([FIXTURE.alice, FIXTURE.shared])
      expect(await repos(ADMIN), '管理员的插件上下文里有别人的项目').toEqual([FIXTURE.shared, FIXTURE.admin])
    } finally {
      harness.cleanup()
    }
  })
})

describe('授权矩阵：其它租户资源（当前设计）', () => {
  it('会话置顶：按账号，管理员看得见全部', async () => {
    // The **content** side, not the project side. A pinned session is a
    // personal bookmark, and the administrator's reach already covers its
    // content - they browse the whole workspace. So this row documents the
    // current rule rather than claiming the project rule applies here.
    const harness = createHarness()
    try {
      const pins = async (caller: Caller) => {
        const response = await harness.app(caller).request('/session-pins')
        expect(response.status).toBe(200)
        const body = (await response.json()) as { pins: Array<{ sessionId: string }> }
        return body.pins.map((pin) => pin.sessionId).sort()
      }

      expect(await pins(ALICE)).toEqual(['ses_alice'])
      expect(await pins(BOB)).toEqual(['ses_bob'])
      expect(await pins(ADMIN), '管理员看不到自己的置顶').toEqual(['ses_admin', 'ses_alice', 'ses_bob'])
    } finally {
      harness.cleanup()
    }
  })

  it('提示词模板：共享库加自己的，管理员看得见全部', async () => {
    // A shared library, not somebody's work. The built-in templates are
    // ownerless on purpose, so they are in everybody's list.
    const harness = createHarness()
    try {
      const templates = async (caller: Caller) => {
        const response = await harness.app(caller).request('/prompt-templates')
        expect(response.status).toBe(200)
        const body = (await response.json()) as { templates?: Array<{ title: string }> }
        return (body.templates ?? []).map((template) => template.title).sort()
      }

      const asAlice = await templates(ALICE)
      expect(asAlice).toContain('alice-template')
      expect(asAlice).not.toContain('bob-template')
      expect(asAlice, '内置模板是共享库，对所有人开放').not.toEqual([])

      const asAdmin = await templates(ADMIN)
      expect(asAdmin).toContain('alice-template')
      expect(asAdmin).toContain('bob-template')
    } finally {
      harness.cleanup()
    }
  })

  it('审计日志：只有管理员进得去', async () => {
    const harness = createHarness()
    try {
      expect((await harness.app(ADMIN).request('/admin/audit/terminal')).status).toBe(200)
      expect((await harness.app(ALICE).request('/admin/audit/terminal')).status).toBe(403)
      expect((await harness.app(null).request('/admin/audit/terminal')).status).toBe(401)
    } finally {
      harness.cleanup()
    }
  })
})

describe('授权矩阵：没有归属的东西不能落成共享行', () => {
  it('导入别人的会话目录时，项目归导入者', async () => {
    // The relink used to leave the owner off, so the rows landed with
    // `user_id IS NULL`. That is not a neutral "shared" state - it is the
    // state the Assistant repository uses, and it means the row is in every
    // account's list, every account's project switcher, and every account's
    // delete button. One person's import put their projects in front of
    // everybody.
    const harness = createHarness()
    try {
      const { relinkReposFromSessionDirectories } = await import('../../src/services/repo')
      const imported = path.join(workspaceRoot, 'imported-project')
      fs.mkdirSync(imported, { recursive: true })
      execFileSync('git', ['init', '-q', imported], { stdio: 'ignore' })

      const result = await relinkReposFromSessionDirectories(
        harness.db,
        STUB_GIT_AUTH,
        [imported],
        ALICE.id,
      )

      expect(result.relinkedCount).toBe(1)
      const [repo] = result.repos
      expect(repo?.userId, '导入的项目没有归属，落成了共享行').toBe(ALICE.id)
      expect(repo?.userId).not.toBeNull()
    } finally {
      harness.cleanup()
    }
  })

  it('认不出是谁的创建请求被拒绝，而不是留下一个共享行', async () => {
    // The same shape as the relink, one route over: a request that cannot be
    // attributed must not write a row everybody can then see and delete.
    const db = new Database(':memory:')
    migrate(db, allMigrations)
    const previousWorkspacePath = process.env.WORKSPACE_PATH
    process.env.WORKSPACE_PATH = workspaceRoot

    // Mounted the way the product mounts it *minus* the session middleware,
    // so the request genuinely carries no identity.
    const app = new Hono()
    app.route(
      '/repos',
      createRepoRoutes(
        db,
        STUB_GIT_AUTH,
        STUB_SCHEDULE_SERVICE,
        createStubOpenCodeClient({ getJson: (async () => []) as never }),
      ),
    )

    try {
      const response = await app.request('/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://example.test/someone/else.git' }),
      })

      expect(response.status, '认不出是谁的请求被放过了').toBe(401)
      const rows = db.prepare('SELECT COUNT(*) AS count FROM repos').get() as { count: number }
      expect(rows.count, '一条没有归属的项目被写进了库').toBe(0)
    } finally {
      db.close()
      if (previousWorkspacePath === undefined) {
        delete process.env.WORKSPACE_PATH
      } else {
        process.env.WORKSPACE_PATH = previousWorkspacePath
      }
    }
  })
})
