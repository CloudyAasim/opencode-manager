import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../helpers/repo-root'
import { buildV1JsonSchema } from '@opencode-manager/shared/api/v1-schema'

const API_V1_DIR = path.join(repoRoot, 'backend/src/routes/api-v1')
const API_V1_DOC = path.join(repoRoot, 'docs/api/v1.md')
const API_V1_SCHEMA = path.join(repoRoot, 'docs/api/v1.schema.json')
const SHAPE_FILE = path.join(repoRoot, 'shared/src/api/v1.ts')
const MOUNT = '/api/v1'

/**
 * The word an agent is called by. `opencode-manager` is the product and does
 * not count; `opencode` on its own is one backend, and a versioned surface
 * that mentions it has stopped being a contract for every backend.
 */
const AGENT_WORD = /(?<![\w-])opencode(?![\w-])/i

function v1Files(): string[] {
  return fs
    .readdirSync(API_V1_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .filter((entry) => !/\.(test|spec)\.ts$/.test(entry.name))
    .map((entry) => path.join(API_V1_DIR, entry.name))
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
  const indexSource = read(path.join(API_V1_DIR, 'index.ts'))
  const mounts = new Map<string, string>()
  for (const match of indexSource.matchAll(/app\.route\(\s*'([^']+)'\s*,\s*([A-Za-z0-9_]+)/g)) {
    mounts.set(match[2]!, match[1]!)
  }

  const routes: DeclaredRoute[] = []
  for (const file of v1Files()) {
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
  const doc = read(API_V1_DOC)
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

describe('版本化 API 的形状', () => {
  it('门禁自己看得见东西', () => {
    expect(v1Files().length, 'routes/api-v1/ 下一个文件都没有了，这条门禁正在空跑').toBeGreaterThan(2)
    expect(declaredRoutes().length, '没从代码里读到任何 v1 端点，这条门禁正在空跑').toBeGreaterThan(5)
    expect(documentedRoutes().length, 'docs/api/v1.md 里没扫到端点，这条门禁正在空跑').toBeGreaterThan(5)
  })

  it('v1 路由不许认识任何一个具体的 agent', () => {
    const offenders: string[] = []
    for (const file of v1Files()) {
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
        `v1 路由里有 ${offenders.length} 处知道了具体是谁在干活：`,
        ...offenders,
        '版本化的表面必须对所有后端说的是同一套话，否则它只是其中一个人的说明书。',
      ].join('\n'),
    ).toEqual([])
  })

  it('形状本身也不许认识任何一个具体的 agent', () => {
    const source = read(SHAPE_FILE)
    expect(
      AGENT_WORD.test(source),
      'shared/src/api/v1.ts 里出现了某一个 agent 的名字，形状就不再是所有后端共用的形状',
    ).toBe(false)
  })

  it('v1 的每个响应都得先过形状', () => {
    const offenders = v1Files()
      .filter((file) => path.basename(file) !== 'respond.ts')
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
        `docs/api/v1.md 里的 ${missingInCode.length} 条端点在代码里不存在：`,
        ...missingInCode,
        '照文档写的客户端会拿到 404，而文档看起来仍然是权威的。',
      ].join('\n'),
    ).toEqual([])

    expect(
      missingInDoc,
      [
        `代码里的 ${missingInDoc.length} 条端点没有写进 docs/api/v1.md：`,
        ...missingInDoc,
        '一个没人写下来的端点，下一轮就会被当成不存在。',
      ].join('\n'),
    ).toEqual([])
  })

  it('给原生客户端用的 JSON Schema 与代码一致', () => {
    const expected = `${JSON.stringify(buildV1JsonSchema(), null, 2)}\n`
    // The file goes through git, and git has an opinion about line endings
    // that differs between the machine that wrote it and the machine that
    // checks it out. What the schema says is not affected by that.
    const actual = read(API_V1_SCHEMA).replace(/\r\n/g, '\n')
    expect(
      actual,
      'docs/api/v1.schema.json 与 shared/src/api/v1.ts 对不上了，重新生成：bun scripts/generate-v1-schema.ts',
    ).toBe(expected)
  })
})
