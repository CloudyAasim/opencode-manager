import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../helpers/repo-root'

const DOC = path.join(repoRoot, 'docs/ocm-cli.md')
const INTERNAL_DIR = path.join(repoRoot, 'backend/src/routes/internal')
const INTERNAL_INDEX = path.join(INTERNAL_DIR, 'index.ts')

function readIfPresent(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

function internalRouteSources(): string[] {
  const out: string[] = [readIfPresent(INTERNAL_INDEX)]
  for (const entry of fs.readdirSync(INTERNAL_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(readFileSync_(path.join(INTERNAL_DIR, entry.name)))
    }
  }
  return out
}

function readFileSync_(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

/** `/api/internal/repos/:repoId/mirror` -> ["", "repos", ":repoId", "mirror"] */
function routeSegments(apiPath: string): string[] {
  return apiPath.replace(/^\/api\/internal/, '').replace(/\/\*$/, '/*').split('/').filter(Boolean)
}

function segmentsMatch(documented: string[], declared: string[]): boolean {
  // An empty declared path must never match: `[].every()` is vacuously true,
  // and the sources do contain a bare quoted '/', so without this every
  // documented endpoint passed and the rule checked nothing at all.
  if (declared.length === 0 || declared.length > documented.length) return false
  const offset = documented.length - declared.length
  return declared.every((segment, index) => {
    const left = documented[offset + index]!
    if (segment.startsWith(':') || left.startsWith(':')) return segment === left || segment.startsWith(':') || left.startsWith(':')
    if (segment === '*' || left === '*') return true
    return segment === left
  })
}

/**
 * A documented endpoint that no longer exists is the quiet kind of wrong: the
 * document still looks authoritative, and the client written against it gets a
 * 404 at runtime with nothing pointing back at the paragraph that sent it
 * there.
 *
 * This table was found drifted - it listed `/api/internal/repo-mirror/:repoId/up`
 * and `.../down`, and neither the prefix nor the path shape exists anywhere in
 * the code. The route modules compose through Hono's `route()`, so a declared
 * path is a *suffix* of the documented one (`/:repoId/mirror` mounted under
 * `/repos`), and this checks for that suffix rather than reconstructing the
 * composed path. It is a looser guarantee than "this resolves", and it is
 * chosen deliberately: a looser check that never false-alarms is worth more
 * here than a tighter one that eventually has to be disabled. The drift it was
 * written for has no suffix match at all, so it is still caught.
 */
describe('文档里的内部端点必须真的存在', () => {
  const doc = fs.readFileSync(DOC, 'utf8')
  const sources = internalRouteSources().join('\n')
  // Only the table rows, not every mention: a note explaining that a path was
  // removed has to be able to quote that path, and quoting it is not a claim
  // that it still resolves.
  const tableRows = doc.split('\n').filter((line) => line.trimStart().startsWith('|'))
  const documented = [
    ...new Set(tableRows.flatMap((line) => [...line.matchAll(/`(\/api\/internal\/[^`]+)`/g)].map((m) => m[1]!))),
  ]
  const declared = [...sources.matchAll(/['"](\/[^'"]*)['"]/g)].map((match) =>
    match[1]!.replace(/\/\*$/, '/.*').split('/').filter(Boolean),
  )

  it('门禁自己看得见东西', () => {
    expect(documented.length, 'ocm-cli.md 里没扫到内部端点，这条门禁正在空跑').toBeGreaterThan(0)
    expect(declared.length, '没读到任何内部路由声明，这条门禁正在空跑').toBeGreaterThan(10)
  })

  it('每条记录的内部端点在代码里都有对应的路由声明', () => {
    const offenders = documented
      .filter((apiPath) => {
        const segments = routeSegments(apiPath)
        return !declared.some((d) => segmentsMatch(segments, d))
      })
      .sort()
    expect(
      offenders,
      [
        `docs/ocm-cli.md 里这 ${offenders.length} 条端点在代码里找不到对应声明：`,
        ...offenders,
        '照文档实现 CLI 的人会拿到 404，而文档看起来仍然是权威的。',
        '要么路由改了（同步文档），要么文档写错了（改文档）。',
      ].join('\n'),
    ).toEqual([])
  })
})
