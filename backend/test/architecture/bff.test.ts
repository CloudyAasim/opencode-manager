import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../helpers/repo-root'

const BFF_DIR = path.join(repoRoot, 'backend/src/routes/bff')
const BFF_DOC = path.join(repoRoot, 'docs/api/bff.md')
const BFF_SHAPE_FILE = path.join(repoRoot, 'shared/src/api/bff.ts')
const FRONTEND_DIR = path.join(repoRoot, 'frontend/src')
const MOUNT = '/api/bff'

/**
 * The word an agent is called by. `opencode-manager` is the product and does
 * not count; `opencode` on its own is one backend, and a layer that mentions
 * it has stopped being a layer for every backend.
 */
const AGENT_WORD = /(?<![\w-])opencode(?![\w-])/i

function bffFiles(): string[] {
  return fs
    .readdirSync(BFF_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .filter((entry) => !/\.(test|spec)\.ts$/.test(entry.name))
    .map((entry) => path.join(BFF_DIR, entry.name))
    .sort()
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

function importedNames(source: string): string[] {
  const names: string[] = []
  for (const match of source.matchAll(/import\s+(?:type\s+)?([^'"]*?)\s*from\s*['"][^'"]+['"]/g)) {
    const clause = match[1] ?? ''
    const braced = clause.match(/\{([\s\S]*)\}/)
    if (braced) {
      for (const piece of (braced[1] ?? '').split(',')) {
        const name = piece.trim().split(/\s+as\s+/).pop()?.trim()
        if (name) names.push(name)
      }
    }
    const defaultName = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, '').trim()
    if (defaultName) names.push(defaultName)
  }
  return names
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = []
  for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) specs.push(match[1]!)
  for (const match of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(match[1]!)
  return specs
}

interface DeclaredRoute {
  method: string
  path: string
}

function declaredRoutes(): DeclaredRoute[] {
  const indexSource = read(path.join(BFF_DIR, 'index.ts'))
  const mounts = new Map<string, string>()
  for (const match of indexSource.matchAll(/app\.route\(\s*'([^']+)'\s*,\s*([A-Za-z0-9_]+)/g)) {
    mounts.set(match[2]!, match[1]!)
  }

  const routes: DeclaredRoute[] = []
  for (const file of bffFiles()) {
    const source = read(file)
    const factory = source.match(/export\s+function\s+([A-Za-z0-9_]+)/)?.[1]
    const prefix = factory ? (mounts.get(factory) ?? '') : ''
    for (const match of source.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
      const suffix = match[2] === '/' ? '' : match[2]
      routes.push({ method: match[1]!.toUpperCase(), path: `${MOUNT}${prefix}${suffix}` })
    }
  }
  return routes
}

function documentedRoutes(): DeclaredRoute[] {
  const doc = read(BFF_DOC)
  const routes: DeclaredRoute[] = []
  for (const row of doc.split('\n')) {
    if (!row.trimStart().startsWith('|')) continue
    const match = row.match(/^\|\s*`(GET|POST|PUT|PATCH|DELETE)`\s*\|\s*`([^`]+)`\s*\|/)
    if (match) routes.push({ method: match[1]!, path: match[2]! })
  }
  return routes
}

function key(route: DeclaredRoute): string {
  return `${route.method} ${route.path}`
}

function frontendSources(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
        found.push(full)
      }
    }
  }
  walk(FRONTEND_DIR)
  return found.sort()
}

describe('给前端的那一层', () => {
  it('门禁自己看得见东西', () => {
    expect(bffFiles().length, 'routes/bff/ 下一个文件都没有了，这条门禁正在空跑').toBeGreaterThan(1)
    expect(declaredRoutes().length, '没从代码里读到任何 BFF 端点，这条门禁正在空跑').toBeGreaterThan(0)
    expect(documentedRoutes().length, 'docs/api/bff.md 里没扫到端点，这条门禁正在空跑').toBeGreaterThan(0)
  })

  it('BFF 路由不许认识任何一个具体的 agent', () => {
    const offenders: string[] = []
    for (const file of bffFiles()) {
      const source = read(file)
      const name = path.basename(file)

      for (const spec of importSpecifiers(source)) {
        if (spec.split('/').some((segment) => segment.toLowerCase() === 'opencode')) {
          offenders.push(`${name} 引入了 ${spec}`)
        }
      }
      for (const imported of importedNames(source)) {
        if (/opencode/i.test(imported)) {
          offenders.push(`${name} 引入了 ${imported}`)
        }
      }
      if (AGENT_WORD.test(source)) {
        offenders.push(`${name} 把某一个 agent 的名字写在了正文里`)
      }
    }

    expect(
      offenders,
      [
        `BFF 里有 ${offenders.length} 处知道了具体是谁在干活：`,
        ...offenders,
        '这一层是给前端用的，它得对所有后端说同一套话，否则换个后端前端就得跟着改。',
      ].join('\n'),
    ).toEqual([])
  })

  it('形状本身也不许认识任何一个具体的 agent', () => {
    const source = read(BFF_SHAPE_FILE)
    expect(
      AGENT_WORD.test(source),
      'shared/src/api/bff.ts 里出现了某一个 agent 的名字，形状就不再是所有后端共用的形状',
    ).toBe(false)
  })

  it('BFF 的每个响应都得先过形状', () => {
    const offenders = bffFiles()
      .filter((file) => /\bc\.json\(/.test(read(file)))
      .map((file) => path.basename(file))
      .sort()

    expect(
      offenders,
      [
        `这些文件自己写了响应：${offenders.join(', ')}`,
        '每个响应都要先过形状才能出门，否则形状只是一张纸。',
        '要发响应就调 respond.ts 里的 ok() 或 fail()。',
      ].join('\n'),
    ).toEqual([])
  })

  it('文档里的端点都得在代码里存在，代码里的端点也都得在文档里', () => {
    const declared = new Set(declaredRoutes().map(key))
    const documented = new Set(documentedRoutes().map(key))

    const missingInCode = [...documented].filter((entry) => !declared.has(entry)).sort()
    const missingInDoc = [...declared].filter((entry) => !documented.has(entry)).sort()

    expect(
      missingInCode,
      [
        `docs/api/bff.md 里的 ${missingInCode.length} 条端点在代码里不存在：`,
        ...missingInCode,
        '照文档写的客户端会拿到 404，而文档看起来仍然是权威的。',
      ].join('\n'),
    ).toEqual([])

    expect(
      missingInDoc,
      [
        `代码里的 ${missingInDoc.length} 条端点没有写进 docs/api/bff.md：`,
        ...missingInDoc,
        '一个没人写下来的端点，下一轮就会被当成不存在。',
      ].join('\n'),
    ).toEqual([])
  })

  it('前端不许再自己去问 agent 的会话列表', () => {
    // The list is the server's job: it merges the directories and keeps the
    // cursors. A client that does it itself has to know how to merge pages,
    // and every place that draws a list has to know that too.
    //
    // The names are what makes this checkable: a path is not enough, because
    // `GET /session` and `POST /session` are the same path and only one of
    // them is a list.
    const AGENT_CLIENT = path.join(FRONTEND_DIR, 'api', 'opencode.ts')
    const offenders: string[] = []

    for (const match of read(AGENT_CLIENT).matchAll(/\basync\s+(listSessions(?:Page)?)\s*\(/g)) {
      offenders.push(`api/opencode.ts 定义了 ${match[1]}`)
    }
    for (const file of frontendSources()) {
      const source = read(file)
      for (const match of source.matchAll(/\basync\s+(listSessionsPage)\s*\(/g)) {
        offenders.push(`${path.relative(repoRoot, file)} 定义了 ${match[1]}`)
      }
    }

    expect(
      offenders,
      [
        `前端还在自己去问 agent 的会话列表：${offenders.join(', ')}`,
        '前端要问这一层，不要问 agent。',
        '自己问的话，合并和游标就散落在每个画列表的地方。',
      ].join('\n'),
    ).toEqual([])
  })

  it('前端不许再自己去问 agent 的待办列表', () => {
    // The same job as the session list: one answer for every working
    // directory, merged by the server. A client that asks the agent per
    // directory pays for two round trips per directory - and it holds the
    // agent's dialect, which is not the dialect the app keeps.
    const AGENT_CLIENT = path.join(FRONTEND_DIR, 'api', 'opencode.ts')
    const offenders: string[] = []

    for (const match of read(AGENT_CLIENT).matchAll(/\basync\s+(listPending(?:Permissions|Questions))\s*\(/g)) {
      offenders.push(`api/opencode.ts 定义了 ${match[1]}`)
    }
    for (const file of frontendSources()) {
      const source = read(file)
      for (const match of source.matchAll(/\basync\s+(listPending(?:Permissions|Questions))\s*\(/g)) {
        offenders.push(`${path.relative(repoRoot, file)} 定义了 ${match[1]}`)
      }
    }

    expect(
      offenders,
      [
        `前端还在自己去问 agent 的待办列表：${offenders.join(', ')}`,
        '前端要问这一层，不要问 agent。',
        '自己问的话，每个目录都要问两次，而答案还得在浏览器里合。',
      ].join('\n'),
    ).toEqual([])
  })

  it('前端确实在问这一层', () => {
    const asking = frontendSources().filter((file) => read(file).includes('/api/bff/sessions'))
    expect(
      asking.length,
      '前端一处也没问这一层，那上面那条门禁就只是在说一件没有发生的事',
    ).toBeGreaterThan(0)

    const askingPending = frontendSources().filter((file) => read(file).includes('/api/bff/pending'))
    expect(
      askingPending.length,
      '前端一处也没问这一层的待办，那上面那条门禁同样在说一件没有发生的事',
    ).toBeGreaterThan(0)
  })

  it('这一层必须把列表收窄到调用者', () => {
    // An agent knows about conversations, not about people. Without this the
    // list is the whole server's list, and it is handed to whoever asked.
    const withList = bffFiles().filter((file) => /listSessions\s*\(/.test(read(file)))
    expect(withList.length, '没找到出会话列表的地方，这条门禁正在空跑').toBeGreaterThan(0)

    const offenders = withList
      .filter((file) => !/callerVisibleSessions|visibleSessions/.test(read(file)))
      .map((file) => path.basename(file))
      .sort()

    expect(
      offenders,
      [
        `这些文件把会话列表原样交出去了：${offenders.join(', ')}`,
        '列表必须先按调用者收窄，不然它就是整个服务器的列表。',
      ].join('\n'),
    ).toEqual([])
  })

  it('这一层必须把待办收窄到调用者', () => {
    // A pending request belongs to a conversation, so the conversation
    // decides whose it is. An agent knows about conversations, not people.
    const withPending = bffFiles().filter((file) => /listPending(?:Permissions|Questions)\s*\(/.test(read(file)))
    expect(withPending.length, '没找到出处待办的地方，这条门禁正在空跑').toBeGreaterThan(0)

    const offenders = withPending
      .filter((file) => !/callerVisiblePendingRequests/.test(read(file)))
      .map((file) => path.basename(file))
      .sort()

    expect(
      offenders,
      [
        `这些文件把待办原样交出去了：${offenders.join(', ')}`,
        '待办必须先按调用者收窄，不然它就是整个服务器的待办。',
      ].join('\n'),
    ).toEqual([])
  })
})
