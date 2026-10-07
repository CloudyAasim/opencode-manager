import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const PKG_ROOT = path.resolve(__dirname, '../../..')
const INDEX_HTML = path.join(PKG_ROOT, 'index.html')
const CONFIG_JS = path.join(PKG_ROOT, 'public/config.js')

const html = fs.readFileSync(INDEX_HTML, 'utf8')
const configScript = fs.readFileSync(CONFIG_JS, 'utf8')

/** The `<script>` tag containing `needle`, matched on the attribute rather than
 *  on a fixed `src=` position.
 *
 *  Two things this must not do. It must not `indexOf('config.js')`, because the
 *  comment explaining why this tag lives in `<head>` mentions config.js and
 *  would be found first - which is how the first version of this gate's shell
 *  equivalent measured a healthy build and called it broken. And it must not
 *  assume `src` is the first attribute, because adding `defer` in front of it
 *  made this report "the script tag is missing" instead of the true reason.
 *
 *  Scanning `<script` and testing the whole tag gets both right.
 */
function tagFor(needle: string): { index: number; tag: string } | null {
  for (let from = 0; ; ) {
    const at = html.indexOf('<script', from)
    if (at === -1) return null
    const close = html.indexOf('>', at)
    if (close === -1) return null
    const tag = html.slice(at, close + 1)
    if (tag.includes(needle)) return { index: at, tag }
    from = at + 1
  }
}

const CONFIG_TAG = tagFor('src="/config.js"')
/** The module entry, identified by where it points rather than by `type`, so
 *  that turning config.js into a module cannot make it stand in for the
 *  entry and hide the very thing being checked. */
const MODULE_TAG = tagFor('src="/src/main.tsx"')
const HEAD_END = html.indexOf('</head>')

/**
 * The bundle reads the server base while its modules are still evaluating, so
 * `config.js` has to have run by then. It did - but only by accident.
 *
 * Vite hoists the module entry into `<head>`, which put the built document in
 * the order
 *
 *     57:  <script type="module" crossorigin src="/assets/main-....js"></script>
 *     75:  <script src="/config.js"></script>
 *
 * Module scripts are deferred and classic scripts are not, so line 75 still
 * executed first. Correct - but correct *because of defer semantics*, not
 * because of where the lines are, and that depends on where the bundler chose
 * to put its entry. Change the build config and the order inverts.
 *
 * When it inverts nothing throws. The app boots, the console is clean, and
 * `__OCM_RUNTIME_CONFIG__` is simply `undefined`, so every request quietly
 * resolves to same-origin: the user picks a server, saves, and the app goes on
 * talking to the old one with no error anywhere. That is the exact failure this
 * whole runtime-server-selection feature exists to prevent, undone by a line
 * of HTML.
 *
 * Two properties hold that independent of the bundler:
 *
 *   1. a classic script in `<head>` runs before parsing finishes, therefore
 *      before any deferred module, whatever the bundler does with the rest;
 *   2. it is still immediately before the module entry, so even a build that
 *      moved the entry back into `<body>` could not invert it.
 *
 * This gate holds both. They are redundant on purpose - property 1 is the one
 * that actually survives a bundler change, and property 2 is the one that fails
 * first and loudest if 1 is ever given up.
 */
describe('运行时配置必须先于 bundle 执行', () => {
  it('门禁自己看得见东西', () => {
    expect(CONFIG_TAG, 'index.html 里找不到 config.js 的 script 标签').not.toBeNull()
    expect(MODULE_TAG, 'index.html 里找不到 module 入口').not.toBeNull()
    expect(HEAD_END, 'index.html 里找不到 </head>').toBeGreaterThan(-1)
    expect(configScript, 'public/config.js 是空的').toContain('__OCM_RUNTIME_CONFIG__')
  })

  it('config.js 在 <head> 里，不在 <body> 里', () => {
    expect(CONFIG_TAG, 'config.js 的 script 标签不存在，无从判断位置').not.toBeNull()
    // `type="module"` alone would still be deferred from <head>, so this is not
    // the load-bearing assertion - but it is a second way for the ordering to
    // stop being guaranteed by the parser, and it belongs on this tag.
    expect(CONFIG_TAG!.tag, 'config.js 变成了 module 脚本').not.toMatch(/\btype=/)
    // `async` would let it land anywhere at all. `defer` happens to keep
    // document order against module scripts today, which is a footnote of the
    // spec rather than a promise of it.
    expect(CONFIG_TAG!.tag, 'config.js 上带了 async 或 defer').not.toMatch(/\b(async|defer)\b/)
    expect(
      CONFIG_TAG!.index,
      'config.js 被挪到了 <body> —— 它在 <body> 里能不能早于 bundle 执行，取决于打包器把入口放在哪',
    ).toBeLessThan(HEAD_END)
  })

  it('config.js 紧邻在 module 入口之前', () => {
    expect(CONFIG_TAG, 'config.js 的 script 标签不存在').not.toBeNull()
    expect(MODULE_TAG, 'module 入口不存在').not.toBeNull()
    expect(
      CONFIG_TAG!.index,
      'config.js 排在 module 入口之后：bundle 求值时会读到 undefined 的运行时配置，静默退回同源',
    ).toBeLessThan(MODULE_TAG!.index)
  })

  it('public/config.js 不会覆盖已有的运行时配置', () => {
    // `window.__OCM_RUNTIME_CONFIG__ = window.__OCM_RUNTIME_CONFIG__ || {}` -
    // an operator who injects the object earlier on the page must not have it
    // wiped out here.
    expect(configScript).toMatch(
      /window\.__OCM_RUNTIME_CONFIG__\s*=\s*window\.__OCM_RUNTIME_CONFIG__\s*\|\|\s*\{\}/,
    )
  })
})