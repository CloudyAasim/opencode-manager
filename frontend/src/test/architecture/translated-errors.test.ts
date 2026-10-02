import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const FILES = (function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...walk(full))
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      const rel = path.relative(FRONTEND_SRC, full).split(path.sep).join('/')
      if (!rel.startsWith('lib/i18n/')) out.push(rel)
    }
  }
  return out
})(FRONTEND_SRC)

/**
 * There are three ways to say something to a user in this app and all three
 * are UI copy: showToast from lib/toast, toast straight from sonner, and
 * showErrorToast from lib/error-toast. A rule that only watched the first one
 * left a whole file invisible - useServerHealth imports toast from sonner, so
 * every string in it was unchecked. Toasts also carry an action label and a
 * description, and the command palette renders descriptions straight from
 * useCommands, which is a fourth place the same mistake was hiding in.
 */
const SITES: ReadonlyArray<readonly [string, RegExp, (text: string) => boolean]> = [
  ['showToast', /showToast\.(?:success|error|info|warning|loading)\(\s*(['"`])((?:(?!\1).)*?)\1/gs, isProse],
  ['sonner toast', /(?:^|[^.\w])toast\.(?:success|error|info|warning|loading)\(\s*(['"`])((?:(?!\1).)*?)\1/gms, isProse],
  // a button label is short by nature - "Restart" is one word and still wrong
  // in a Chinese UI, so this one does not need two of them
  ['toast action label', /action:\s*\{\s*label:\s*(['"`])((?:(?!\1).)*?)\1/gs, isShortLabel],
  ['toast description', /description:\s*(['"`])((?:(?!\1).)*?)\1/gs, isProse],
  ['error fallback', /(?:getOpenCodeApiErrorMessage|showErrorToast)\([^,()]*,\s*(['"`])((?:(?!\1).)*?)\1/gs, isProse],
  ['command description', /description:\s*(['"`])((?:(?!\1).)*?)\1(?=[,\s]*\n\s*template:)/g, isProse],
]

function withoutTemplates(text: string): string {
  return text.replace(/\$\{[^}]*\}/g, ' ').trim()
}

/** Two literal words is the bar for prose. It separates a sentence from a
 *  model identifier (`provider/model`) and from a composed description that is
 *  mostly a t() call with something interpolated around it. */
function isProse(text: string): boolean {
  const literal = withoutTemplates(text)
  return /\p{Ll}{3,}/u.test(literal) && /\S+\s+\S+/.test(literal)
}

/** Labels are short. "Save" or "Restart" is one word and still wrong. */
function isShortLabel(text: string): boolean {
  return /\p{L}{2,}/u.test(withoutTemplates(text))
}

describe('用户会读到的提示必须跟着语言走', () => {
  it('门禁自己看得见东西', () => {
    expect(FILES.length, '源文件少得可疑').toBeGreaterThan(300)
    expect(SITES.length, 'SITES 少了入口').toBe(6)
  })

  it('toast、它的按钮与描述、错误兜底，都不能是写死的英文字面量', () => {
    const offenders: string[] = []
    for (const rel of FILES) {
      const text = fs.readFileSync(path.join(FRONTEND_SRC, rel), 'utf8')
      for (const [kind, pattern, isCopy] of SITES) {
        for (const match of text.matchAll(pattern)) {
          const value = (match[2] ?? '').trim()
          if (isCopy(value)) {
            offenders.push(`${rel}:${text.slice(0, match.index!).split('\n').length} [${kind}] ${value.slice(0, 70)}`)
          }
        }
      }
    }
    expect(
      offenders,
      `这些提示没有走 t()，中文用户会看到英文：\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('命令面板的描述也走 t()，它是被渲染出来的', () => {
    // CommandSuggestions renders command.description directly, so a literal
    // here is an English command palette for a Chinese user.
    const source = read('hooks/useCommands.ts')
    expect(source, 'useCommands 里还有写死的命令描述').not.toMatch(
      /description:\s*'[A-Z][^']*\s[A-Za-z]/,
    )
  })

  it('命令清单的缓存键带着语言，否则切语言后显示的还是上一种语言', () => {
    // The descriptions are translated, so a cached list keyed without the
    // locale keeps being rendered after a switch. Nothing about this is a
    // string literal, which is why it needs its own assertion.
    const source = read('hooks/useCommands.ts')
    const key = /queryKey:\s*\[([^\]]*)\]/.exec(source)?.[1] ?? ''
    expect(key, 'useCommands 的 queryKey 必须包含 locale').toContain('locale')
  })
})

function read(rel: string): string {
  return fs.readFileSync(path.join(FRONTEND_SRC, rel), 'utf8')
}
