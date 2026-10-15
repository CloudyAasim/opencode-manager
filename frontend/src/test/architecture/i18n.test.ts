import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { en } from '@/lib/i18n/locales/en'
import { zhCN } from '@/lib/i18n/locales/zh-CN'
import { buildImportGraph, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const fileRel = (file: string) => relativeTo(graph, file)

// Both quote styles. The old expression demanded a single quote and this
// app writes 72 call sites as t("..."), so the "every literal key must
// exist" rule was not looking at a third of them.
//
// Known gap, closed in two steps.
//
// The gap was: a key that only ever appears as one branch of a ternary, as an
// argument to a helper, as `tRef.current('k')` or as a value in an object
// literal is still not checked. Widening the expression to "any quoted dotted
// string under a known namespace" was measured and rejected - 95 false
// positives, because generated SSE event names share a namespace with the
// locale files and are not translation keys at all.
//
// The scanner now leaves generated files out of the graph (see
// `import-graph.ts`), which is what removed the generated half of those 95 -
// not an exclusion list, but the file saying what it is. What remains is 12,
// every one of them an SSE event name in one hand-written module, which is
// small enough to declare rather than to keep guessing.
const LOOKUP = /\bt\(\s*(['"])([a-zA-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\1/g
const LABEL_KEY = /\blabelKey:\s*(['"])([a-zA-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\1/g
// A key assembled inside a template literal, e.g.
// t(`settings.users.errors.${raw}`). The old expression demanded a bare
// identifier followed by dotted words, which no call site here
// satisfies - so the test that used it passed over an empty set and
// proved nothing at all.
const VARIABLE_KEY = /\bt\(\s*`([^`$]*)\$\{[^}]*\}([^`]*)`/g

// Every quoted dotted string under a namespace the locale files actually own
// is treated as a key. That is deliberately blunt: the narrow form missed keys
// wherever the call site did not look like `t('...')`, and a missing key does
// not announce itself - i18next hands back the key itself, so the interface
// shows `repo.list.repoCount` to the user and nothing logs.
const QUOTED_UNDER_NAMESPACE = /(['"])([a-zA-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\1/g

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
    for (const match of source.matchAll(re)) found.add(match[2]!)
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

const NAMESPACES = new Set(Object.keys(en as Record<string, unknown>))

/**
 * Strings that sit under a locale namespace and are deliberately not keys.
 *
 * Whether a dotted string is a translation key or a protocol name cannot be
 * derived from its shape - `session.created` is a valid key shape and is not a
 * key - so it is declared here and enforced the way `optimistic-writes`
 * declares its decisions. The list is the whole answer: a new one has to be
 * written down with a reason, and a stale one turns the gate red.
 */
const NOT_TRANSLATION_KEYS: Array<[string, string]> = [
  ['message.part.delta', 'SSE event name'],
  ['message.part.removed', 'SSE event name'],
  ['message.part.updated', 'SSE event name'],
  ['message.removed', 'SSE event name'],
  ['message.updated', 'SSE event name'],
  ['session.compacted', 'SSE event name'],
  ['session.created', 'SSE event name'],
  ['session.deleted', 'SSE event name'],
  ['session.error', 'SSE event name'],
  ['session.idle', 'SSE event name'],
  ['session.status', 'SSE event name'],
  ['session.updated', 'SSE event name'],
]

function declaredNonKeys(): Set<string> {
  return new Set(NOT_TRANSLATION_KEYS.map(([key]) => key))
}

function quotedKeysUnderNamespace(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8')
  const found = new Set<string>()
  for (const match of source.matchAll(QUOTED_UNDER_NAMESPACE)) {
    const key = match[2]!
    if (NAMESPACES.has(key.split('.')[0]!)) found.add(key)
  }
  return [...found]
}

function unresolvableQuotedKeys(): string[] {
  const offenders: string[] = []
  const declared = declaredNonKeys()
  for (const file of FILES) {
    for (const key of quotedKeysUnderNamespace(file)) {
      if (declared.has(key)) continue
      if (!resolveKey(en, key)) offenders.push(`${fileRel(file)}  ->  ${key}`)
    }
  }
  return offenders
}

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

    // This loop only has `key`. It used to reach for `file` in the failure
    // message, and because resolveKey had always been true the branch had
    // never run - so the one time it had something to report, it threw a
    // ReferenceError instead of naming the key. A guard nobody has ever
    // seen fire is not a guard.
    const offenders: string[] = []
    for (const key of prefixes) {
      const head = key.split('*')[0]!.replace(/\.$/, '')
      if (!head) continue
      if (!resolveKey(en, head)) {
        offenders.push(`${head}  (模板键前缀，来源见下方 allTemplateKeyPrefixes)`)
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

  it('命名空间下的任何带引号字符串都必须是能解析的键', () => {
    const offenders = unresolvableQuotedKeys()
    expect(
      offenders,
      [
        `这些字符串长成翻译键的样子，语言包里却没有：${offenders.length} 处`,
        ...offenders,
        'i18next 找不到键时返回键本身，不报错，所以界面上会直接显示原始 key 而没有任何日志。',
        '如果它确实不是翻译键（比如 SSE 事件名），请写进 NOT_TRANSLATION_KEYS 并说明理由。',
      ].join('\n'),
    ).toEqual([])
  })

  it('声明过的非键必须正好是实际的那一批', () => {
    const declared = NOT_TRANSLATION_KEYS.map(([key]) => key).sort()
    const actual: string[] = []
    for (const file of FILES) {
      for (const key of quotedKeysUnderNamespace(file)) {
        if (!resolveKey(en, key)) actual.push(key)
      }
    }
    expect(
      { declared, actual: [...new Set(actual)].sort() },
      [
        '声明与实际不符。少一条 = 有人新写了一个长得像键的东西没登记；',
        '多一条 = 有人把它变成了真的翻译键，声明该退休了。',
      ].join('\n'),
    ).toEqual({ declared, actual: [...new Set(actual)].sort() })
  })
})
