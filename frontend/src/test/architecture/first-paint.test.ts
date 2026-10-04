import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

// FRONTEND_SRC is already frontend/src, so the entry sits at its root.
const ENTRY = 'main.tsx'
const ENTRY_ABS = path.join(FRONTEND_SRC, ENTRY)

/**
 * Nothing here should be downloaded before the user asks for it.
 *
 * The terminal emulator and the markdown pipeline (react-markdown with remark,
 * rehype and highlight.js) used to sit in the entry chunk. The reason was
 * small and stupid: the shell inspector's terminal and file-browser entries
 * were registration stubs whose components return null, and they imported
 * their view synchronously anyway. Those stubs are gone now - the inspector
 * was removed because the session page already carries its own right-hand
 * panel - so this is now a standing rule rather than a fix for a known cause.
 * Separately, a handful of values imported from the shared package's root
 * barrel pulled in zod, because that barrel re-exports every schema module and
 * each of those opens with `import { z } from 'zod'`.
 *
 * buildImportGraph cannot be used to measure this: it records `import('x')`
 * with typeOnly:false, so walking its edges from the entry reaches every lazy
 * route as well. This gate walks the sources itself and stops at the first
 * dynamic import, which is what a browser actually does.
 */
const NOT_ON_FIRST_PAINT = [
  '@xterm/xterm',
  '@xterm/addon-fit',
  'react-markdown',
  'remark-gfm',
  'remark-parse',
  'rehype-raw',
  'rehype-highlight',
  'highlight.js',
  'zod',
]

const SOURCE_EXT = ['.ts', '.tsx']

/** Specifiers that actually put code in the importing file's own bundle. */
function eagerSpecifiers(source: string): string[] {
  // import('...') and lazy(() => import('...')) are separate requests; strip
  // them before anything else looks for a specifier.
  const withoutDynamic = source.replace(/\bimport\s*\(\s*['"][^'"]+['"]\s*\)/g, ' ')
  const specs: string[] = []
  const re = /(?:^|\n)\s*import\s+(?!type\s)([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(withoutDynamic)) !== null) specs.push(m[2]!)
  const bare = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
  while ((m = bare.exec(withoutDynamic)) !== null) specs.push(m[1]!)
  return specs
}

function resolveLocal(spec: string, fromFile: string): string | null {
  let target: string | null = null
  if (spec === '@' || spec.startsWith('@/')) {
    target = path.join(FRONTEND_SRC, spec.slice(1).replace(/^\/+/, ''))
  } else if (spec.startsWith('.')) {
    target = path.resolve(path.dirname(fromFile), spec)
  }
  if (!target) return null
  for (const candidate of [target, ...SOURCE_EXT.map((ext) => target + ext), ...SOURCE_EXT.map((ext) => path.join(target, 'index' + ext))]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

interface Reach {
  files: Set<string>
  packages: Set<string>
}

function firstPaint(): Reach {
  const files = new Set<string>([ENTRY_ABS])
  const packages = new Set<string>()
  const queue = [ENTRY_ABS]
  while (queue.length) {
    const file = queue.shift()!
    const source = fs.readFileSync(file, 'utf8')
    for (const spec of eagerSpecifiers(source)) {
      const local = resolveLocal(spec, file)
      if (local) {
        if (files.has(local)) continue
        files.add(local)
        queue.push(local)
        continue
      }
      if (spec.startsWith('@opencode-manager/shared')) {
        // The root barrel re-exports ./schemas. Anything importing a value
        // from it drags zod along; the package ships finer entry points.
        if (spec === '@opencode-manager/shared') packages.add(spec)
        continue
      }
      if (NOT_ON_FIRST_PAINT.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`))) {
        packages.add(spec)
      }
    }
  }
  return { files, packages }
}

const first = firstPaint()

describe('首屏不下载用不到的东西', () => {
  it('门禁自己看得见东西', () => {
    expect(graph.files.length, '源文件少得可疑，这门禁多半跑在空集上').toBeGreaterThan(300)
    expect(fs.existsSync(ENTRY_ABS), `找不到入口 ${ENTRY}`).toBe(true)
    // A walk that stopped early, or that resolved nothing, would make the
    // rule below pass for the wrong reason.
    expect(first.files.size, '入口闭包小得可疑，它可能根本没走起来').toBeGreaterThan(20)
    const rels = [...first.files].map((f) => relativeTo(graph, f))
    expect(rels).toContain('App.tsx')
    // And it must reach eager third-party code, not only local modules.
    expect(rels.some((rel) => rel.startsWith('framework/'))).toBe(true)
  })

  it('入口闭包里没有终端、markdown 栈、zod，也没有 shared 的根 barrel', () => {
    expect(
      [...first.packages].sort(),
      '这些重依赖还在首屏：\n' + [...first.packages].sort().join('\n'),
    ).toEqual([])
  })
})
