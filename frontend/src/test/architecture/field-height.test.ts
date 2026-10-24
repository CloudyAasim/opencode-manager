import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfAttrs, stripComments, tagAt } from './source-text'

/**
 * 字段的高度只有一副。
 *
 * 一个输入框和一个下拉框是**同一个零件的两张脸**——它们挨着放在同一行里，
 * 读起来是同一句话。它们的字号是同一副（上一轮定的 `field-text`），它们的高
 * 度却不是：
 *
 * - 共享的输入框是 36px；
 * - 共享的下拉框是 40px。
 *
 * 于是**同一行里有两个高度** ✗。而调用点还各自写着高度（22 处），所以连共享
 * 零件自己写的那一档都不算数 ✗。
 *
 * 所以这一轮：
 *
 * - 输入框与下拉框都有了一道尺寸的属性，走的是**按钮那道楼梯**：`xs` 是 28、
 *   `sm` 是 32、`default` 是 36、`lg` 是 40。同一个名字，在按钮上和在字段上，
 *   是同一个高度 ✓——这样一行里放着一个按钮和一个字段，它们才真的是一行。
 * - 下拉框那一档从 40px 变成 36px，和输入框一样 ✓。
 * - 调用点不再写死高度：要哪一档就说哪一档。
 *
 * 判的是**形状**：一个字段的类名里有没有写死高度、共享的那几档各自是多高、
 * 同一个尺寸名字在按钮和字段上是不是同一个高度。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的那些字段。 */
const SHARED_FIELDS: Record<string, string> = {
  Input: 'components/ui/input.tsx',
  SelectTrigger: 'components/ui/select.tsx',
}

/** 按钮那道楼梯（上一轮定的）。 */
const BUTTON_LADDER: Record<string, number> = {
  '2xs': 24,
  xs: 28,
  sm: 32,
  default: 36,
  lg: 40,
}

/** 字段那一道楼梯：与按钮同名的那几档，高度必须一样。 */
const FIELD_LADDER: Record<string, number> = {
  xs: 28,
  sm: 32,
  default: 36,
  lg: 40,
}

/** 一串类名里写死的高度（没有断点前缀的那种）。 */
function fixedHeight(list: string): string | null {
  for (const token of list.split(/\s+/)) {
    if (/^(?:h|size)-(\d+)$/.test(token)) return token
  }
  return null
}

/** Tailwind 的步长：`h-6` 是 24px（一步 4px）。 */
function pixelsOf(token: string | null): number | null {
  if (!token) return null
  const match = /(\d+)$/.exec(token)
  return match ? Number(match[1]) * 4 : null
}

/** 一个文件里，尺寸那一段的每一档写了什么。 */
function variantsOf(source: string): Map<string, string> {
  const found = new Map<string, string>()
  const at = source.indexOf('size: {')
  if (at < 0) return found
  let depth = 0
  let end = at
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1
    else if (source[end] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const body = source.slice(at, end)
  for (const match of body.matchAll(/"?([\w-]+)"?:\s*"([^"]*)"/g)) {
    found.set(match[1]!, match[2]!)
  }
  return found
}

/** 一个字段的调用点。 */
interface CallSite {
  rel: string
  line: number
  part: string
  list: string
}

function callSites(): CallSite[] {
  const found: CallSite[] = []
  for (const source of SOURCES) {
    for (const part of Object.keys(SHARED_FIELDS)) {
      const matcher = new RegExp(`<${part}\\b`, 'g')
      let match: RegExpExecArray | null
      while ((match = matcher.exec(source.text)) !== null) {
        const opening = tagAt(source.text, match.index)
        const attrs = opening.slice(part.length + 1, opening.endsWith('>') ? -1 : undefined)
        found.push({
          rel: source.rel,
          line: source.text.slice(0, match.index).split('\n').length,
          part,
          list: classListOfAttrs(attrs) ?? '',
        })
      }
    }
  }
  return found
}

const CALL_SITES = callSites()

describe('字段的高度只有一副', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    for (const [name, rel] of Object.entries(SHARED_FIELDS)) {
      const shared = SOURCES.find((source) => source.rel === rel)
      expect(shared, `找不到共享的 ${name}`).toBeDefined()
      const variants = variantsOf(shared!.text)
      expect(variants.size, `共享的 ${name} 没有尺寸档，这道门禁多半读错了地方`).toBeGreaterThan(3)
    }

    // 找得到调用点。
    expect(CALL_SITES.length, '一个字段的调用点都没找到').toBeGreaterThan(50)

    // 认得出"写死的高度"和"某一档屏幕起才生效的高度"——这两个不一样。
    expect(fixedHeight('h-7 px-2'), '认不出写死的高度').toBe('h-7')
    expect(fixedHeight('md:h-7 px-2'), '把断点上的高度当成了写死的').toBe(null)
    expect(pixelsOf('h-9'), '认不出 36px 那一档').toBe(36)
  })

  it('共享的字段自己写明了每一档有多高', () => {
    const offenders: string[] = []
    for (const [name, rel] of Object.entries(SHARED_FIELDS)) {
      const shared = SOURCES.find((source) => source.rel === rel)!
      const variants = variantsOf(shared.text)
      for (const [size, expected] of Object.entries(FIELD_LADDER)) {
        const list = variants.get(size)
        if (!list) {
          offenders.push(`${name}  没有 ${size} 这一档`)
          continue
        }
        const phone = pixelsOf(fixedHeight(list))
        if (phone !== expected) {
          offenders.push(`${name}  ${size} 应该是 ${expected}px，现在是 ${phone ?? '(没有)'}`)
        }
      }
      for (const size of variants.keys()) {
        if (FIELD_LADDER[size]) continue
        offenders.push(`${name}  多出了 ${size} 这一档`)
      }
    }

    expect(
      offenders,
      [
        `共享的字段没有写明自己每一档有多高：${offenders.length} 处`,
        ...offenders,
        '字段和按钮走同一道楼梯：28 / 32 / 36 / 40。',
      ].join('\n'),
    ).toEqual([])
  })

  it('同一个尺寸名字，在按钮上和在字段上是同一个高度', () => {
    // 一行里放着一个按钮和一个字段，它们要真的是一行——所以 `size="sm"` 在两边
    // 必须是一个高度。
    const button = SOURCES.find((source) => source.rel === 'components/ui/button.tsx')!
    const buttonVariants = variantsOf(button.text)

    const offenders: string[] = []
    for (const [size, expected] of Object.entries(BUTTON_LADDER)) {
      const list = buttonVariants.get(size)
      if (!list) {
        offenders.push(`按钮  没有 ${size} 这一档`)
        continue
      }
      const phone = pixelsOf(fixedHeight(list))
      if (phone !== expected) {
        offenders.push(`按钮  ${size} 应该是 ${expected}px，现在是 ${phone ?? '(没有)'}`)
      }
    }

    for (const [name, rel] of Object.entries(SHARED_FIELDS)) {
      const shared = SOURCES.find((source) => source.rel === rel)!
      const variants = variantsOf(shared.text)
      for (const size of Object.keys(FIELD_LADDER)) {
        const phone = pixelsOf(fixedHeight(variants.get(size) ?? ''))
        if (phone !== BUTTON_LADDER[size]) {
          offenders.push(
            `${name}  ${size} 是 ${phone ?? '(没有)'}px，按钮的 ${size} 是 ${BUTTON_LADDER[size]}px`,
          )
        }
      }
    }

    expect(
      offenders,
      [
        `同一个尺寸名字在两处不是一个高度：${offenders.length} 处`,
        ...offenders,
        '同一个名字就是同一个高度——不然一行里放着一个按钮和一个字段，它们不是一行。',
      ].join('\n'),
    ).toEqual([])
  })

  it('调用点不再写死字段的高度', () => {
    // 共享的字段说它有多高，调用点就不再说第二遍。
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      const height = fixedHeight(site.list)
      if (!height) continue
      offenders.push(`${site.rel}:${site.line}（${site.part}）  ${height}`)
    }

    expect(
      offenders,
      [
        `这些地方又写了一遍字段的高度：${offenders.length} 处`,
        ...offenders,
        '字段有多高是共享字段的事：调用点要哪一档，就说哪一档（`size="xs"`）。',
      ].join('\n'),
    ).toEqual([])
  })
})
