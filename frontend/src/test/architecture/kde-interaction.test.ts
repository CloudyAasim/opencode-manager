import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments } from './source-text'
import { en } from '@/lib/i18n/locales/en'
import { zhCN } from '@/lib/i18n/locales/zh-CN'

/**
 * KDE's Human principle, in the parts a machine can check.
 *
 * "Let the user stay in control and understand what is happening" is a
 * sentence about behaviour, and behaviour is not visible in the source. But
 * three of its consequences are:
 *
 * - A dialog that destroys something has to say what it is about to do, to
 *   the people who cannot see the screen as well as to the ones who can.
 * - The same action has to be called the same thing everywhere.
 * - A control that only exists on hover does not exist on a touch screen.
 *
 * The rules below are those three, written down.
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

const DESTRUCTIVE = 'components/ui/confirm-destructive-dialog.tsx'
const DELETE_DIALOG = 'components/ui/delete-dialog.tsx'

const sourceOf = (rel: string): string => {
  const found = SOURCES.find((source) => source.rel === rel)
  expect(found, `找不到 ${rel}`).toBeDefined()
  return found!.text
}

describe('KDE 的"让人清楚正在发生什么"', () => {
  it('门禁看得见文件', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)
    expect(SOURCES.some((source) => source.rel === DESTRUCTIVE)).toBe(true)
    expect(SOURCES.some((source) => source.rel === DELETE_DIALOG)).toBe(true)
  })

  it('危险操作的说明要能被读屏软件读到', () => {
    // The dialog content turns the automatic description wiring off, so the
    // text that says what is about to happen was never announced: a screen
    // reader user could open "Delete project" and hear nothing about what
    // deletion means.
    const source = sourceOf(DESTRUCTIVE)
    expect(
      source,
      '危险对话框没有把说明接上 aria-describedby，读屏软件读不到它',
    ).toMatch(/aria-describedby=\{[^}]*descriptionId[^}]*\}/)
    expect(source, '说明没有自己的 id，无法被 aria-describedby 指到').toMatch(/<DialogDescription id=\{descriptionId\}/)
  })

  it('同一个动作只有一种说法', () => {
    // The same button was called "Try again", "Try Again" and "Retry" in
    // three different places, and two of the keys were not used by anything.
    const offenders = SOURCES.filter((source) => /t\(['"][a-zA-Z.]*tryAgain['"]\)/.test(source.text)).map(
      (source) => source.rel,
    )
    expect(
      offenders,
      [
        `这些地方还在用各自命名的"重试"：${offenders.length} 处`,
        ...offenders,
        '统一用 common.retry。',
      ].join('\n'),
    ).toEqual([])

    expect((en as Record<string, unknown>).common).toBeDefined()
    expect((zhCN as Record<string, unknown>).common).toBeDefined()
  })

  it('按钮的文案由调用方决定，不由标题的文字决定', () => {
    // The delete dialog used to look for the word "Configuration" in its own
    // title to decide what the button should say. The title is translated, so
    // the check only ever fired in English.
    const source = sourceOf(DELETE_DIALOG)
    expect(
      source,
      '删除对话框又靠嗅探标题的文字来选按钮文案了',
    ).not.toMatch(/\.includes\(\s*['"][A-Za-z ]+['"]\s*\)/)
    expect(source, '删除对话框没有接收按钮文案的入口').toMatch(/confirmLabel\?: string/)
  })

  it('触摸设备上，悬停才出现的按钮必须一直都在', () => {
    // A button that is transparent until the pointer is over it is a button
    // that does not exist on a phone: there is no hover, so it stays
    // invisible and cannot be pressed.
    //
    // "Shown again at some width" counts - `max-sm:opacity-100`, or the
    // other branch of a ternary that asks whether the device is a phone. What
    // does not count is `group-hover:opacity-100`, because a touch screen
    // never hovers - and `md:opacity-100` does not count either, because a
    // phone is below md.
    const offenders: string[] = []
    for (const source of SOURCES) {
      for (const match of source.text.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
        const expression = match[1] ?? match[2] ?? ''
        if (!/\bopacity-0\b/.test(expression)) continue
        const alwaysVisible = [...expression.matchAll(/((?:[\w-]+:)?)opacity-100\b/g)].some(
          (hit) => {
            const prefix = (hit[1] ?? '').replace(/:$/, '')
            return prefix === '' || prefix.startsWith('max-')
          },
        )
        if (alwaysVisible) continue
        offenders.push(`${source.rel}  ${expression.replace(/\s+/g, ' ').trim().slice(0, 90)}`)
      }
    }
    expect(
      offenders,
      [
        `这些按钮在触摸设备上永远看不见：${offenders.length} 处`,
        ...offenders,
        '小屏上用 max-sm:opacity-100 把它显出来。',
      ].join('\n'),
    ).toEqual([])
  })
})
