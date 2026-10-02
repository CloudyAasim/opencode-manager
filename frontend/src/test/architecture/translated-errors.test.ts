import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../..')

const FILES = (function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...walk(full))
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(path.relative(SRC, full).split(path.sep).join('/'))
    }
  }
  return out
})(SRC)

/** A user-facing error string written as a literal. The app has a translation
 *  system; an error toast is exactly the message a user is most likely to read
 *  when something has gone wrong. */
const LITERAL_ERROR =
  /show(?:Toast|ErrorToast)\.error\(\s*([`'"(])(?:(?!\1).)*\b(?:Failed|Cannot|Error|Unknown error|not supported|unsupported)\b(?:(?!\1).)*\1/gis

/**
 * For two years the success messages in these handlers went through t() and the
 * failure messages were typed in English, so a user running the app in Chinese
 * saw a Chinese "Schedule created" and an English "Failed to create schedule".
 * Sixteen of them, across five files.
 */
describe('错误提示必须跟着语言走', () => {
  it('门禁自己看得见东西', () => {
    expect(FILES.length, '源文件少得可疑，这门禁多半跑在空集上').toBeGreaterThan(300)
  })

  it('showToast.error 的提示不能是写死的英文字面量', () => {
    const offenders: string[] = []
    for (const rel of FILES) {
      const text = fs.readFileSync(path.join(SRC, rel), 'utf8')
      for (const match of text.matchAll(LITERAL_ERROR)) {
        offenders.push(`${rel}  ->  ${match[0].replace(/\s+/g, ' ').slice(0, 90)}`)
      }
    }
    expect(
      offenders,
      `这些错误提示没有走 t()，中文用户会看到英文：\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
