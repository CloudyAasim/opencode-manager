import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const PKG_ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(PKG_ROOT, rel), 'utf8')

const vitestConfig = read('vitest.config.ts')
const css = read('src/index.css')

/** `{a,b}` -> `a`, `b`. One level is all vitest's globs use; a fuller expander
 *  would end up being the thing under test. */
function expandBraces(input: string): string[] {
  const open = input.indexOf('{')
  if (open === -1) return [input]
  const close = input.indexOf('}', open)
  if (close === -1) return [input]
  const out: string[] = []
  for (const part of input.slice(open + 1, close).split(',')) {
    out.push(...expandBraces(input.slice(0, open) + part + input.slice(close + 1)))
  }
  return out
}

/** What vitest will run, expanded. */
function includeGlobs(): string[] {
  const block = vitestConfig.match(/include:\s*\[([^\]]*)\]/)
  expect(block, 'vitest.config.ts 里读不到 include 数组').not.toBeNull()
  const out: string[] = []
  for (const m of block![1]!.matchAll(/['"]([^'"]+)['"]/g)) out.push(...expandBraces(m[1]!))
  return out
}

/** What index.css tells Tailwind to stop scanning. */
function excludeGlobs(): string[] {
  return [...css.matchAll(/@source\s+not\s+"([^"]+)"/g)].map((m) => m[1]!)
}

/** The same path as the stylesheet sees it.
 *
 *  vitest resolves its globs from the package root, so `src/**\/*.test.ts` is
 *  that file. `@source not` resolves from the stylesheet, which lives at
 *  `src/index.css`, so the same file is `./**\/*.test.ts`. One prefix swap is
 *  the whole translation - and getting it wrong is silent, because a glob that
 *  matches nothing excludes nothing and the build carries on.
 */
function asSeenByTheStylesheet(vitestGlob: string): string {
  return vitestGlob.replace(/^src\//, './')
}

/**
 * Tailwind reads every source file as plain text and emits a rule for anything
 * shaped like a class name. Automatic detection covers the whole repo minus
 * .gitignore, so all 207 test files were in scope and 746 bytes of dead CSS
 * had accumulated - `.invert` most memorably, from the word "inverts" in a
 * comment.
 *
 * The bytes were the cheap part. The expensive part is that it makes the
 * stylesheet a function of the test suite: adding a test rewrites the shipped
 * bundle, so "this change touches no production code" cannot be checked by
 * comparing artifacts, and a class can reach production because some test
 * mentioned it and was later deleted - leaving the rule behind with its reason
 * gone.
 *
 * `index.css` therefore excludes exactly what vitest includes. Nothing holds
 * that link in place: rename the globs, or add a suffix, and the exclusion
 * quietly stops matching - the original bug with a new filename attached.
 * This gate is what holds it.
 */
describe('Tailwind 不许把测试文件当成类名来源', () => {
  it('门禁自己看得见东西', () => {
    const included = includeGlobs()
    expect(included.length, '从 vitest include 里解析不出 glob').toBeGreaterThan(0)
    expect(excludeGlobs().length, 'index.css 里找不到 @source not').toBeGreaterThan(0)
    // If this stops holding, the translation below is wrong rather than the
    // exclusion being wrong, and it must not pass silently.
    for (const glob of included) {
      expect(glob, `vitest 的 include 不以 src/ 开头，无法换算：${glob}`).toMatch(/^src\//)
    }
  })

  it('vitest 会跑的每个 glob，都在 index.css 里被排除了', () => {
    const excluded = excludeGlobs()
    const missing = includeGlobs()
      .map(asSeenByTheStylesheet)
      .filter((glob) => !excluded.includes(glob))
    expect(
      missing,
      `这些文件 vitest 会跑、Tailwind 仍会扫：\n${missing.join('\n')}\n` +
        '它们的内容会进生产样式表（改一次 vitest include 就可能漏掉新的后缀）',
    ).toEqual([])
  })

  it('index.css 没有多排除任何东西', () => {
    const expected = includeGlobs().map(asSeenByTheStylesheet).sort()
    const actual = excludeGlobs().sort()
    expect(
      actual,
      '多出来的排除项会让应用静默掉样式 —— 只该按测试后缀排除，不该按目录排除',
    ).toEqual(expected)
  })

  it('排除项是相对 index.css 解析的', () => {
    for (const glob of excludeGlobs()) {
      expect(glob, `"${glob}" 缺少 ./ 前缀；相对 src/index.css 会指到别处，且不报错`).toMatch(/^\.\//)
    }
  })
})