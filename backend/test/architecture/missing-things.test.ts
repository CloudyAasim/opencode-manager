import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../helpers/repo-root'

const ADAPTER = path.join(repoRoot, 'backend/src/providers/opencode/adapter.ts')
const CONTRACT = path.join(repoRoot, 'backend/src/providers/contract.ts')
const RESPOND = path.join(repoRoot, 'backend/src/routes/api-v1/respond.ts')
const SHAPE = path.join(repoRoot, 'shared/src/api/v1.ts')

/**
 * The three ways a call can say what it is about.
 *
 * They are the whole vocabulary: a conversation, a thing with a name, and a
 * call that names nothing. A call that does not use one of them says nothing
 * about what a "not there" would be about - and that is how a sentence about
 * a conversation ended up on a question about a tool server.
 */
const WAYS = ['conversation(', 'thing(', 'unnamed()']

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

/**
 * Every call in the adapter that can be answered with a "not there".
 *
 * The two ways out of the adapter are `readJson` and `write`, and both of
 * them end in `translate`. So a call that does not go through one of them
 * cannot be answered with a missing thing - and a call that does has to say
 * what it was asking about.
 */
function translateReachableCalls(source: string): { line: number; text: string }[] {
  const lines = source.split(/\r?\n/)
  const calls: { line: number; text: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const isRead = /this\.readJson</.test(lines[i]!)
    const isWrite = /this\.write\(\{/.test(lines[i]!)
    if (!isRead && !isWrite) continue

    // The statement ends where its brackets close.
    let depth = 0
    let started = false
    let text = ''
    for (let j = i; j < Math.min(i + 40, lines.length); j++) {
      text += lines[j]! + '\n'
      for (const ch of lines[j]!) {
        if ('([{'.includes(ch)) {
          depth++
          started = true
        } else if (')]}'.includes(ch)) depth--
      }
      if (started && depth <= 0) break
    }
    calls.push({ line: i + 1, text })
  }

  return calls
}

describe('错也要用版本化的话', () => {
  it('门禁自己看得见东西', () => {
    const calls = translateReachableCalls(read(ADAPTER))

    expect(
      calls.length,
      '适配器里一处会 404 的调用都没扫到，这条门禁正在空跑',
    ).toBeGreaterThan(20)
    expect(calls.some((call) => call.text.includes('conversation('))).toBe(true)
    expect(calls.some((call) => call.text.includes('thing('))).toBe(true)
    expect(calls.some((call) => call.text.includes('unnamed()'))).toBe(true)
  })

  it('每一处会 404 的调用，都要说清自己问的是什么', () => {
    const offenders: string[] = []

    for (const call of translateReachableCalls(read(ADAPTER))) {
      if (WAYS.some((way) => call.text.includes(way))) continue
      offenders.push(`adapter.ts:${call.line} 没有说自己问的是什么`)
    }

    expect(
      offenders,
      [
        `这些调用没说自己问的是什么：`,
        ...offenders,
        '上游说「没有」的时候，这层得知道说的是哪件事没有，',
        '否则这句话就会是关于会话的那一句，而被问的那件事根本不是会话。',
      ].join('\n'),
    ).toEqual([])
  })

  it('「没有会话」那句话只住在跟会话有关的地方', () => {
    // The sentence is about a conversation. A file that is about something
    // else - a tool server, a model, a provider - must not say it: a client
    // that is told "no session" goes looking for the session, and there was
    // never a session in the question.
    const offenders: string[] = []

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue
        if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue
        if (!read(full).includes('No session is known')) continue

        const base = path.basename(full)
        // The error itself is the sentence's home, and the files that talk
        // about conversations are allowed to use it.
        if (base === 'contract.ts') continue
        if (/session/i.test(base)) continue
        offenders.push(path.relative(repoRoot, full))
      }
    }
    walk(path.join(repoRoot, 'backend/src'))

    expect(
      offenders,
      [
        `这些地方说了「没有会话」，而它们说的不是会话：${offenders.join(', ')}`,
        '那句话是关于会话的。别的什么东西没有的时候，要说那是什么东西没有。',
      ].join('\n'),
    ).toEqual([])

    expect(read(CONTRACT)).toContain('No session is known')
  })

  it('版本化的话里有「没有这个东西」这一种', () => {
    const shape = read(SHAPE)

    expect(
      shape.includes("'resource_not_found'"),
      '版本化的错误码里没有「没有这个东西」这一种，所以这句话没有地方说',
    ).toBe(true)
    expect(
      shape.includes('MissingResourceSchema'),
      '缺了那样东西时，说得出它是哪一样的那份形状不见了',
    ).toBe(true)
    expect(read(CONTRACT)).toContain('export class ResourceNotFoundError')
    expect(read(RESPOND)).toContain('ResourceNotFoundError')
  })

  it('不许再说「不知道是哪一次会话」', () => {
    const adapter = read(ADAPTER)

    expect(
      adapter.includes("?? '*'"),
      [
        '适配器又把「没有会话」说成了不知道是哪一次的那一句。',
        '一个被告知会话不见了的人，会去找那个会话 - 而这里根本没有会话这件事。',
      ].join('\n'),
    ).toBe(false)
  })
})
