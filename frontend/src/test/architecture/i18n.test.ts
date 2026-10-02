import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { en } from '@/lib/i18n/locales/en'
import { zhCN } from '@/lib/i18n/locales/zh-CN'
import { buildImportGraph, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const fileRel = (file: string) => relativeTo(graph, file)

const LOOKUP = /\bt\(\s*'([a-zA-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)'/g
const LABEL_KEY = /\blabelKey:\s*'([a-zA-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)'/g
// A key assembled inside a template literal, e.g.
// t(`settings.users.errors.${raw}`). The old expression demanded a bare
// identifier followed by dotted words, which no call site here
// satisfies - so the test that used it passed over an empty set and
// proved nothing at all.
const VARIABLE_KEY = /\bt\(\s*`([^`$]*)\$\{[^}]*\}([^`]*)`/g

function has(bundle: unknown, key: string): boolean {
  return key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc === null || typeof acc !== 'object' ? undefined : (acc as Record<string, unknown>)[part]),
      bundle,
    ) !== undefined
}

// i18next resolves a `count` argument to the _one / _other suffixed keys, so a
// key that never appears verbatim can still be perfectly translated.
function resolveKey(bundle: unknown, key: string): boolean {
  if (has(bundle, key)) return true
  return has(bundle, `${key}_one`) && has(bundle, `${key}_other`)
}

function keysIn(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8')
  const found = new Set<string>()
  for (const re of [LOOKUP, LABEL_KEY]) {
    for (const match of source.matchAll(re)) found.add(match[1]!)
  }
  return [...found].sort()
}

function allTemplateKeyPrefixes(): string[] {
  return [...new Set(FILES.flatMap(templateKeyPrefixes))].sort()
}

function templateKeyPrefixes(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8')
  const found = new Set<string>()
  for (const match of source.matchAll(VARIABLE_KEY)) {
    found.add(`${match[1]}*${match[2]}`)
  }
  return [...found].sort()
}

const FILES = graph.files.filter((file) => {
  const rel = fileRel(file)
  if (rel.includes('/test') || rel.startsWith('test/')) return false
  if (rel.includes('.test.') || rel.includes('.spec.')) return false
  return rel.endsWith('.ts') || rel.endsWith('.tsx')
})

describe('翻译键契约', () => {
  it('门禁本身在看文件', () => {
    // A rule whose subject set is empty passes without looking at anything.
    // That is not a hypothetical: this filter once read
    //   rel.endsWith('.ts') && rel.endsWith('.tsx')
    // which no string can satisfy, so the assertions below ran over zero
    // files and still reported success.
    expect(
      FILES.length,
      `i18n 门禁只匹配到 ${FILES.length} 个文件，等于什么都没看`,
    ).toBeGreaterThan(100)
  })

  it('字面量翻译键在英文包中必须存在', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      for (const key of keysIn(file)) {
        if (!resolveKey(en, key)) {
          offenders.push(`${fileRel(file)}  ->  ${key}`)
        }
      }
    }
    expect(
      offenders,
      [
        `这些 t() 键在 en 中解析不到，界面上会直接显示原始 key：${offenders.length} 处`,
        ...offenders,
        'i18next 找不到键时返回键本身，不报错，所以这类问题不会自己暴露。',
      ].join('\n'),
    ).toEqual([])
  })

  it('模板拼接的翻译键，其静态前缀必须存在', () => {
    const prefixes = allTemplateKeyPrefixes()
    expect(
      prefixes.length,
      [
        '一个模板拼接的翻译键都没扫到，这条断言在空集上通过。',
        '它上一版就是这样：正则要求字面量部分以裸标识符开头，',
        '而代码里写的是 t(`settings.users.errors.${raw}`)，',
        '于是这条门禁一直在证明一件不存在的事。',
      ].join('\n'),
    ).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const key of prefixes) {
      {
        const head = key.split('*')[0]!.replace(/\.$/, '')
        if (!head) continue
        if (!resolveKey(en, head)) {
          offenders.push(`${fileRel(file)}  ->  ${key}`)
        }
      }
    }
    expect(offenders, `模板键的静态前缀解析不到：${offenders.length} 处\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  it('中英文包必须拥有完全相同的键集合', () => {
    const collect = (bundle: unknown, prefix = ''): string[] => {
      if (bundle === null || typeof bundle !== 'object') return []
      if (Array.isArray(bundle)) return []
      return Object.entries(bundle as Record<string, unknown>).flatMap(([key, value]) => {
        const next = prefix ? `${prefix}.${key}` : key
        return typeof value === 'string' ? [next] : collect(value, next)
      })
    }
    const enKeys = new Set(collect(en))
    const zhKeys = new Set(collect(zhCN))
    const missing = [...enKeys].filter((key) => !zhKeys.has(key)).sort()
    const extra = [...zhKeys].filter((key) => !enKeys.has(key)).sort()

    expect(
      { missingInZh: missing, extraInZh: extra },
      [
        `zh-CN 缺少 ${missing.length} 个键，多出 ${extra.length} 个`,
        ...missing.map((key) => `  zh 缺: ${key}`),
        ...extra.map((key) => `  zh 多: ${key}`),
      ].join('\n'),
    ).toEqual({ missingInZh: [], extraInZh: [] })
  })
})
