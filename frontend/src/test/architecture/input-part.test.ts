import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfTag, stripComments, tagAt } from './source-text'

/**
 * 输入框只有一副。
 *
 * 上一轮把**字号**收成了一副（`field-text`），这一轮收的是**输入框本身**。
 *
 * 道理是一样的：一个能往里写字的框，是同一个零件的两张脸——它在设置里、在搜索
 * 栏里、在下拉框顶上、在一行按钮旁边，它都该是那一个框。而实际上，这个应用里
 * 散着一批**自己画的输入框** ✗：工作区的搜索框自己写着 40px ✗，语音设置的 API
 * 端点自己写着 40px ✗，下拉框里的搜索框自己写着 32px ✗，会话的命令面板里还有
 * 一个自己写着 32px 的 ✗。
 *
 * 每一处自己写的高度，都是一处"这里为什么不一样"没说出口 ✗。于是这一轮：
 *
 * - 能当普通字段的，都换成共享的那一副 ✓，要哪一档就说哪一档 ✓
 *   （`size="lg"` 是 40px ✓，`size="sm"` 是 32px ✓）✓。
 * - 剩下的不是普通字段的（行内改名字、代码行里的编辑、按键捕获、名字自己的
 *   那一档字号……），**一个个点名，写清楚它们为什么不是那一副** ✓，连它们的高
 *   度是楼梯上的哪一档都写出来 ✓。
 *
 * 判的是**形状**：一个能看见的文本输入框，除了共享的那一副自己和点名的那几个，
 * 不该再有别的 ✓。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的那一副。 */
const SHARED_INPUT = 'components/ui/input.tsx'

/**
 * 那道楼梯：同一个名字在按钮上和在字段上是同一个高度。
 *
 * `h-7` 是 28（`xs`）、`h-8` 是 32（`sm`）、`h-9` 是 36（`default`）、
 * `h-10` 是 40（`lg`）✗——点名的那些也要走这一道楼梯 ✗。
 */
const LADDER: Record<string, number> = {
  'h-7': 28,
  'h-8': 32,
  'h-9': 36,
  'h-10': 40,
}

/** 不显示字的输入框：文件、勾选框、按钮。 */
const NOT_TEXT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/** 看不见的输入框：藏起来的、只给读屏器念的。 */
const INVISIBLE = /\b(?:hidden|sr-only)\b/

interface Field {
  rel: string
  line: number
  /** 它自己那一串类名。 */
  list: string
}

/** 一个文件里的原生文本输入框。 */
function fieldsIn(rel: string, text: string): Field[] {
  const found: Field[] = []
  const lists = classListOfTag(text, 'input')
  const matcher = /<input\b/g
  let index = 0
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text)) !== null) {
    const opening = tagAt(text, match.index)
    const attrs = opening.slice('input'.length + 1, opening.endsWith('>') ? -1 : undefined)
    const type = /\btype\s*=\s*"([^"]*)"/.exec(attrs)?.[1]
    if (type && NOT_TEXT_TYPES.has(type)) {
      index += 1
      continue
    }
    const list = lists[index] ?? ''
    // 看不见的输入框不算：它不是给人往里写字的。
    if (INVISIBLE.test(list)) {
      index += 1
      continue
    }
    found.push({
      rel,
      line: text.slice(0, match.index).split('\n').length,
      list,
    })
    index += 1
  }
  return found
}

const FIELDS = SOURCES.flatMap((source) => fieldsIn(source.rel, source.text))

/**
 * 不是普通字段的那几个。
 *
 * 每一���都写着理由 ✗——写不出理由的，就是该换成共享那一副的 ✗。
 * `height` 是它的高度（楼梯上的那一档）✗：写不了高度的那几个（自己跟着一行字
 * 走的、跟着一行代码走的）是 `null` ✗。
 */
interface Exception {
  file: string
  reason: string
  height: string | null
}

const NOT_AN_ORDINARY_FIELD: readonly Exception[] = [
  {
    file: 'components/ui/combobox.tsx',
    reason: '共享的那一副是下拉框自己；这一行是它盒子里的那一行，它跟盒子一起高',
    height: 'h-9',
  },
  {
    file: 'components/ui/header.tsx',
    reason: '行内改标题：它是一行字里的一个编辑框，不是一个字段',
    height: 'h-8',
  },
  {
    file: 'features/session/SessionCard.tsx',
    reason: '行内改名字：它在一张卡片里改一个名字，不是一个字段',
    height: 'h-7',
  },
  {
    file: 'components/ui/virtualized-text-view.tsx',
    reason: '代码行里的编辑：它跟那一行代码一样高，不是字段',
    height: null,
  },
  {
    file: 'components/ui/EditSessionTitleDialog.tsx',
    reason: '名字的字段：字号是名字自己那一档（20px），不是普通字段',
    height: null,
  },
  {
    file: 'features/repos/RenameRepoDialog.tsx',
    reason: '名字的字段：字号是名字自己那一档，不是普通字段',
    height: null,
  },
  {
    file: 'features/settings/KeyboardShortcuts.tsx',
    reason: '按键捕获：它等的不是字，是一次按键',
    height: null,
  },
  {
    file: 'features/file-browser/MarkdownRenderer.tsx',
    reason: 'markdown 内容里的原生输入：那是文档的一部分，不是应用的字段',
    height: null,
  },
  {
    file: 'pages/SessionDetail.tsx',
    reason: '面板标题行上的一个无框搜索行：它和面板的标题是一行，不是一个字段',
    height: 'h-8',
  },
]

function exceptionFor(rel: string): Exception | undefined {
  return NOT_AN_ORDINARY_FIELD.find((entry) => entry.file === rel)
}

/** 一串类名里写死的高度。 */
function fixedHeight(list: string): string | null {
  for (const token of list.split(/\s+/)) {
    if (/^h-(\d+)$/.test(token)) return token
  }
  return null
}

describe('输入框只有一副', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 找得到共享的那一副。
    expect(
      SOURCES.some((source) => source.rel === SHARED_INPUT),
      '找不到共享的输入框，这道门禁读错了地方',
    ).toBe(true)

    // 找得到原生的输入框。
    expect(FIELDS.length, '一个原生输入框都没找到，这道门禁多半跑在空集上').toBeGreaterThan(5)
    expect(
      FIELDS.some((field) => field.rel === SHARED_INPUT),
      '连共享的那一副自己都没有，这道门禁读错了地方',
    ).toBe(true)

    // 认得出"会显示字的输入框"和"不显示字的输入框"——这两个不一样。
    const texts = FIELDS.map((field) => field.rel)
    expect(texts, '把文件选择框当成了输入框').not.toContain('features/settings/UploadFolderButton.tsx')
    expect(texts, '把勾选框当成了输入框').not.toContain('features/repos/AddRepoDialog.tsx')

    // 认得出写死的高度，也认得出那部楼梯。
    expect(fixedHeight('h-8 w-full'), '认不出写死的高度').toBe('h-8')
    expect(fixedHeight('md:h-8 w-full'), '把断点上的高度当成了写死的').toBe(null)
    expect(LADDER['h-9'], '认不出 36px 那一档').toBe(36)
    expect(INVISIBLE.test('sr-only w-10'), '认不出看不见的输入框').toBe(true)
    expect(INVISIBLE.test('flex w-full'), '把看得见的输入框当成了看不见的').toBe(false)

    // 看不见的输入框不算——它不是给人往里写字的。
    expect(
      fieldsIn('sample.tsx', '<input type="text" className="sr-only" />').length,
      '把看不见的输入框算进去了',
    ).toBe(0)
    expect(
      fieldsIn('sample.tsx', '<input type="text" className="w-full" />').length,
      '把看得见的输入框漏掉了',
    ).toBe(1)
  })

  it('能看见的输入框只有共享的那一副', () => {
    // 一个能往里写字的框，要么是共享的那一副，要么是点名的那几个。
    // 其余的，都是自己画的输入框 ✗。
    const offenders: string[] = []
    for (const field of FIELDS) {
      if (field.rel === SHARED_INPUT) continue
      if (exceptionFor(field.rel)) continue
      offenders.push(`${field.rel}:${field.line}  ${field.list.slice(0, 70)}`)
    }

    expect(
      offenders,
      [
        `这些地方自己画了一个输入框：${offenders.length} 处`,
        ...offenders,
        '用共享的 <Input />：要哪一档就说哪一档（`size="xs"` / `sm` / `default` / `lg`）。',
        '确实不是普通字段的，写进 NOT_AN_ORDINARY_FIELD 并说明理由。',
      ].join('\n'),
    ).toEqual([])
  })

  it('例外的理由都写清楚了，而且都还在', () => {
    for (const entry of NOT_AN_ORDINARY_FIELD) {
      expect(entry.reason.trim().length, `${entry.file} 没有写为什么它不是普通字段`).toBeGreaterThan(0)
      const source = SOURCES.find((candidate) => candidate.rel === entry.file)
      expect(source, `例外里的 ${entry.file} 已经不存在了`).toBeDefined()

      const fields = FIELDS.filter((field) => field.rel === entry.file)
      expect(fields.length, `例外里的 ${entry.file} 已经不再有输入框了`).toBeGreaterThan(0)
      // 一个例外只放过一个输入框——不然它就成了一整张执照。
      expect(
        fields.length,
        `例外里的 ${entry.file} 现在有 ${fields.length} 个输入框，例外只放过一个`,
      ).toBe(1)

      // 点名的那几个，高度也得是楼梯上的那一档。
      if (entry.height === null) continue
      expect(LADDER[entry.height], `${entry.file} 点名的 ${entry.height} 不在楼梯上`).toBeDefined()
      const height = fixedHeight(fields[0]!.list)
      expect(height, `${entry.file} 说自己是 ${entry.height}，实际上没有写死高度`).toBe(entry.height)
    }
  })

  it('点名的那些，理由和高度都还成立', () => {
    // 理由里写着"不是普通字段"的那几个，共享的那一副真的不能替它：它们要么
    // 跟着别的东西一起高，要么自己的字号是名字那一档。
    const offenders: string[] = []
    for (const entry of NOT_AN_ORDINARY_FIELD) {
      const fields = FIELDS.filter((field) => field.rel === entry.file)
      if (fields.length !== 1) continue
      const list = fields[0]!.list
      if (entry.height === null) {
        // 自己跟着一行字走的那些：它没有写死高度，也没有用共享的字号。
        if (fixedHeight(list) !== null) {
          offenders.push(`${entry.file}  说自己是跟着一行走的，却写了 ${fixedHeight(list)}`)
        }
        continue
      }
      if (fixedHeight(list) !== entry.height) {
        offenders.push(`${entry.file}  说自己是 ${entry.height}，现在是 ${fixedHeight(list) ?? '(没有)'}`)
      }
    }

    expect(
      offenders,
      [
        `这些例外已经名不副实：${offenders.length} 处`,
        ...offenders,
        '理由和高度都要跟着代码一起变。',
      ].join('\n'),
    ).toEqual([])
  })
})
