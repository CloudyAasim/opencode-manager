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

// The other half of the same contract, in a different tree. The page reserves
// the top inset; the shell must not take that space away by hiding the system
// bar. Checked here rather than in a Kotlin test because CI compiles only
// `:proxy:test` - `:app` needs the Android SDK - so an assertion over the
// Kotlin source is the only one that runs on every push.
const MAIN_ACTIVITY = path.resolve(
  FRONTEND_SRC,
  '../../android/app/src/main/kotlin/dev/opencodemanager/app/MainActivity.kt',
)

/**
 * The request that hides the system status bar, however it is spelled.
 *
 * The `(?:[\w]+\.)*` is not decoration. The first version of this match was
 * `hide\(\s*WindowInsets\.Type\.statusBars\(\)`, and the mutation that put the
 * hiding back wrote it fully qualified - `hide(android.view.WindowInsets.Type
 * .statusBars())` - and survived. The gate was only ever able to see the short
 * form, so it reported the code absent when it was present. A check that
 * recognises one spelling of a call is not a check.
 */
const HIDE_STATUS_BAR =
  /hide\s*\(\s*(?:[\w]+\.)*WindowInsets(?:Compat)?\.Type\s*\.\s*statusBars\s*\(\s*\)/

/**
 * The theme the activity runs under, for the same reason `MainActivity` is
 * read: hiding the bar is something the theme can also do, silently, with one
 * line and no Kotlin at all.
 */
const THEMES_XML = path.resolve(FRONTEND_SRC, '../../android/app/src/main/res/values/themes.xml')

function mainActivity(): string {
  return fs.readFileSync(MAIN_ACTIVITY, 'utf8')
}

function themes(): string {
  return fs.readFileSync(THEMES_XML, 'utf8')
}

/**
 * Kotlin's comments, removed, for the reason `stripComments` below explains -
 * and it is not a hypothetical one here. The comment written to justify
 * `APPEARANCE_LIGHT_STATUS_BARS` names that constant, so a scan of raw source
 * would find the word and report the appearance as set even if every call to it
 * had been deleted.
 *
 * The `[^:]` before `//` keeps `http://127.0.0.1` intact: the URL really is in
 * this file, and a comment stripper that ate it would corrupt the source it is
 * being asked to inspect.
 */
function stripKotlinComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/**
 * Asking for dark status-bar icons, however it is spelled.
 *
 * `APPEARANCE_LIGHT_STATUS_BARS` is a constant, so the token is the same whether
 * it is written bare or off `WindowInsetsController` - hence the optional
 * qualifier chain rather than a hard-coded prefix.
 */
const SETS_LIGHT_STATUS_BARS =
  /setSystemBarsAppearance\s*\(\s*(?:[\w]+\.)*APPEARANCE_LIGHT_STATUS_BARS\b/

/** The pre-R spelling, on the other branch of the same decision. */
const SETS_LIGHT_STATUS_BAR_FLAG =
  /systemUiVisibility\s*=\s*[^;]*?\bSYSTEM_UI_FLAG_LIGHT_STATUS_BAR\b/

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

  /**
   * The other half. Hiding the system's status bar used to be the answer to
   * "the bar sits on top of the page's own header" - it made the overlap go
   * away by removing the bar rather than by making room for it, and left a
   * strip at the top of every phone screen that belonged to nothing.
   *
   * Now that TopBar reserves the inset, hiding it would take away exactly the
   * space that reservation exists to occupy, and the phone would lose the clock,
   * the signal and the battery to get a blank strip instead.
   */
  it('安卓壳不再藏起系统状态栏，因为页面自己已经给它留了位置', () => {
    // Self-check first: a gate that reads nothing here would pass on the
    // absence of the code rather than on its presence.
    expect(fs.existsSync(MAIN_ACTIVITY), `找不到 ${MAIN_ACTIVITY}`).toBe(true)
    const source = mainActivity()
    expect(source.length, 'MainActivity.kt 读出来是空的').toBeGreaterThan(1000)
    expect(fs.existsSync(THEMES_XML), `找不到 ${THEMES_XML}`).toBe(true)

    expect(
      source,
      '安卓壳又开始藏系统状态栏了：手机顶部那条位置会重新变成没有内容的留白',
    ).not.toMatch(HIDE_STATUS_BAR)
    expect(
      source,
      '安卓壳又开始用 SYSTEM_UI_FLAG_FULLSCREEN 藏状态栏了',
    ).not.toMatch(/SYSTEM_UI_FLAG_FULLSCREEN/)

    // The same bar can be hidden from the theme instead, with no Kotlin
    // involved, so both files have to be read or the check above is watching
    // only one of the two doors.
    expect(
      stripKotlinComments(themes()),
      '主题又开始用 windowFullscreen 藏系统状态栏了',
    ).not.toMatch(/windowFullscreen/)
  })

  /**
   * Restoring the bar is not the same as making it visible, and this gate is
   * here because the difference is invisible to every other check.
   *
   * Not hiding it any more is only half of it. `APPEARANCE_LIGHT_STATUS_BARS`
   * decides whether the clock and the battery are drawn white or near-black,
   * and it is off by default; this app's theme is light and the page behind
   * the bar is white. So the bar comes back as a strip of pure white carrying
   * pure white icons, which is pixel-for-pixel what hiding it looked like.
   *
   * What makes this so easy to ship broken is that `dumpsys window` reports
   * `InsetsSource type=statusBars ... visible=true` the entire time - the bar
   * genuinely is being drawn, only nothing on it is legible. An insets dump
   * and a screenshot disagree, and the dump is the one that reads as
   * authoritative.
   */
  it('安卓壳必须请求深色状态栏图标，否则恢复出来的是一条白带，等于没修', () => {
    const kotlin = stripKotlinComments(mainActivity())

    // Deliberately requires the constant as an argument to the call rather
    // than merely present in the file: a local `val` that is never passed
    // satisfies a presence-only check. This will one day complain about an
    // innocent refactor that hoists the constant into a val, and that friction
    // is the intended price for not passing on the day it is not an argument.
    expect(
      kotlin,
      '安卓壳没有请求 APPEARANCE_LIGHT_STATUS_BARS：状态栏恢复了，但时钟/电量是白色图标画在白色背景上，看不见',
    ).toMatch(SETS_LIGHT_STATUS_BARS)

    // The same requirement on the other branch of the same version check.
    // `minSdk = 26`, so without this the fix only exists above API 30.
    expect(
      kotlin,
      'API 30 以下没有设置 SYSTEM_UI_FLAG_LIGHT_STATUS_BAR：这些设备上状态栏同样是白带',
    ).toMatch(SETS_LIGHT_STATUS_BAR_FLAG)
  })

  it('状态栏外观必须在窗口内容装好之后再设置', () => {
    // `window.insetsController` hangs off the decor view. Touching it before
    // `setContentView` installs one is a hard NPE, and `?.` does not help -
    // the receiver is the window, not a nullable controller.
    const kotlin = stripKotlinComments(mainActivity())
    const contentView = kotlin.search(/setContentView\s*\(/)
    // `(?!fun )` skips the declaration, which reads `private fun styleTheStatusBar()`.
    const styleCall = kotlin.search(/(?<!fun )styleTheStatusBar\s*\(\s*\)/)

    expect(contentView, 'MainActivity.kt 里找不到 setContentView，这条检查读错了东西').toBeGreaterThan(-1)
    expect(styleCall, 'MainActivity.kt 里没有调用 styleTheStatusBar').toBeGreaterThan(-1)
    expect(
      styleCall > contentView,
      '在 setContentView 之前设置状态栏外观：decor view 还不存在，会直接崩',
    ).toBe(true)
  })

  it('这条门禁自己没有被注释骗过', () => {
    // The whole `APPEARANCE_LIGHT_STATUS_BARS` check is worthless if the word
    // can be satisfied by prose, and prose is exactly what surrounds it: the
    // comment explaining why the call exists names the constant.
    const withComments = mainActivity()
    const without = stripKotlinComments(withComments)
    expect(without.length, 'Kotlin 注释剥离把整个文件都吃掉了').toBeLessThan(withComments.length)
    // And it must not be eating the URL, which really is in this file.
    expect(
      without.includes('http://127.0.0.1'),
      'Kotlin 注释剥离把源码里的 URL 也吃掉了',
    ).toBe(true)
  })

  it('两边是一份契约：页面留位，壳不藏且让状态栏看得见', () => {
    // Stated as one rule because either half alone is half a fix: a page that
    // reserves nothing with a shell that hides nothing gets the overlap back,
    // and a page that reserves the inset under a shell that hides nothing but
    // styles nothing gets a dead strip that merely looks less blank.
    const pageReserves = /\bpt-safe\b/.test(code(TOPBAR))
    const kotlin = stripKotlinComments(mainActivity())
    const shellHides = HIDE_STATUS_BAR.test(kotlin)
    const shellStyles = SETS_LIGHT_STATUS_BARS.test(kotlin)
    expect(
      pageReserves && shellHides,
      '页面留了顶部安全区，安卓壳却又把系统状态栏藏了：那条位置会空着。' +
        '要么让页面不再保留（但那样状态栏又会压在标题上），要么让壳把状态栏放回来。',
    ).toBe(false)
    expect(
      pageReserves && shellStyles,
      '页面留了顶部安全区，安卓壳却没设置状态栏外观：那条位置会是一条白带。' +
        '恢复系统状态栏必须同时请求深色图标，否则等于什么都没修。',
    ).toBe(true)
  })
})
