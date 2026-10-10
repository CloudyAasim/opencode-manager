import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: fs.readFileSync(file, 'utf8'),
}))

const TOPBAR = 'framework/shell/TopBar.tsx'
const PAGE_HEADER = 'components/ui/page-header.tsx'

const isTest = (rel: string) => rel.includes('.test.')
const production = SOURCES.filter((source) => !isTest(source.rel))

/**
 * Comments out, because a class name mentioned in prose is not a class name.
 *
 * The first version of this gate scanned raw source and failed on its own
 * fix: the comment added to `page-header.tsx` explaining that `pt-safe` had
 * been removed contains the string `pt-safe`. It would also have passed the
 * TopBar assertion for the wrong reason - the new comment there explains
 * `min-h-11`, so the check would have seen the word and called it a match even
 * if the class list had never changed.
 *
 * A check that reads the wrong thing is worse than no check, because it reports
 * a result.
 */
function stripComments(text: string): string {
  return text
    // JSX comments: {/* ... */}
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // Line comments, but not the `//` inside a URL.
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/** Every production file that writes `padding-top: env(safe-area-inset-top)`. */
function topInsetClaimers() {
  return production
    .filter((source) => /\bpt-safe\b/.test(stripComments(source.text)))
    .map((source) => source.rel)
}

const code = (rel: string) => stripComments(SOURCES.find((source) => source.rel === rel)!.text)

/**
 * The files allowed to reserve the top safe-area inset, and why each one is
 * genuinely the top edge of the screen.
 *
 * This is the whole point of the gate: adding an entry is a decision someone has
 * to make out loud, with a reason, rather than something that happens because a
 * header was copied. The list was one entry long and wrong until this round -
 * `PageHeader` reserved an inset for a box that is never at the top.
 */
const TOP_INSET_OWNERS = new Map<string, string>([
  // The shell bar. It is the first thing in the flex column and starts at y=0,
  // so on a phone with a punch hole it is the only part of the normal page that
  // is actually behind the hole.
  [TOPBAR, '外壳顶栏，全局唯一贴着屏幕顶边的常规元素'],
  // Overlays. These do cover the entire screen, so the inset is theirs to take -
  // they are drawn above the shell bar, not below it.
  ['components/ui/fullscreen-sheet.tsx', '全屏 sheet，盖住整屏'],
  ['components/ui/side-drawer.tsx', '侧边抽屉，fixed 覆盖整屏高度'],
  ['components/ui/EditSessionTitleDialog.tsx', '手机上全屏的改名弹窗'],
  ['features/file-browser/MobileFilePreviewModal.tsx', '全屏文件预览弹窗'],
])

describe('顶部安全区：只能由贴着屏幕顶边的那一层认领', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这门禁多半跑在空集上').toBeGreaterThan(300)
    for (const rel of [TOPBAR, PAGE_HEADER]) {
      expect(SOURCES.some((source) => source.rel === rel), `找不到 ${rel}`).toBe(true)
    }
    // If this read nothing, every assertion below would pass vacuously - the
    // same way an earlier check in this repo compared two failed lookups and
    // called them equal.
    expect(topInsetClaimers().length, '一个 pt-safe 都没扫到，这门禁没有判别力').toBeGreaterThan(0)
    expect(TOP_INSET_OWNERS.has(TOPBAR)).toBe(true)
  })

  it('外壳顶栏认领顶部安全区，因为它是唯一贴着屏幕顶边的那一层', () => {
    const topbar = code(TOPBAR)
    expect(topbar, '顶栏没有为挖孔留位置，手机上标题会被挡住').toMatch(/\bpt-safe\b/)

    // `h-11` cannot also hold the inset: with a fixed height the padding comes
    // out of the content box and the bar stops being 44px tall.
    //
    // The lookbehind matters: `\bh-11\b` matches inside `min-h-11` too, because
    // `-` is not a word character, so the plain regex reported a fixed height
    // on a bar that no longer had one.
    expect(
      /className="[^"]*(?<![\w-])h-11\b/.test(topbar),
      '顶栏又变回固定高度 44px，装不下顶部安全区',
    ).toBe(false)
    expect(topbar).toMatch(/\bmin-h-11\b/)
  })

  it('页面自己的标题栏不认领顶部安全区，因为它上面永远还有外壳顶栏', () => {
    expect(
      /\bpt-safe\b/.test(code(PAGE_HEADER)),
      'PageHeader 又开始为挖孔留位置了：刘海机会在两条标题栏之间多出 52px 空白',
    ).toBe(false)
  })

  it('认领顶部安全区的文件与允许名单逐一相符', () => {
    const claimed = new Set(topInsetClaimers())
    const allowed = new Set(TOP_INSET_OWNERS.keys())

    const unexpected = [...claimed].filter((rel) => !allowed.has(rel)).sort()
    expect(
      unexpected,
      `这些文件开始认领顶部安全区，但没有说明理由：${unexpected.join(', ')}。` +
        '要么它确实贴着屏幕顶边（那就写进 TOP_INSET_OWNERS 并注明原因），要么删掉 pt-safe。',
    ).toEqual([])

    // The other direction matters just as much: an owner that no longer exists
    // is a stale entry that would quietly hide the next real offender.
    const stale = [...allowed].filter((rel) => !claimed.has(rel)).sort()
    expect(stale, `允许名单里的文件已经不认领顶部安全区了，请更新：${stale.join(', ')}`).toEqual([])
  })

  it('认领者都注明了理由', () => {
    for (const [rel, reason] of TOP_INSET_OWNERS) {
      expect(reason.trim().length, `${rel} 没有写为什么可以认领顶部安全区`).toBeGreaterThan(0)
    }
  })
})