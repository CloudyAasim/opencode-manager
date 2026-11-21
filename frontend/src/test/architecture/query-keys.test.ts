import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments } from './source-text'

/**
 * A key prefix. `*` stands for a slot whose value is not spelled out.
 *
 * React-query matches an invalidation by prefix: the key that is refreshed
 * must be the beginning of the key that was written. So a prefix is all this
 * gate needs to know about a key.
 */
type Prefix = string[]

/** The shapes one expression may stand for. A ternary has more than one. */
type Shapes = Prefix[]

interface Binding {
  /** The text the name is bound to. */
  value: string
  /** The parameters, when the name is a function. */
  params?: string
  /** A function's body is not an expression - it holds the returned shape. */
  isFunction?: boolean
}

interface Site {
  rel: string
  line: number
  /** The text of the key as it was written. */
  expr: string
  /** The shapes it stands for, or null when the gate cannot read it. */
  shapes: Shapes | null
}

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

/** This gate itself. It writes down the very patterns it looks for. */
const SELF = 'test/architecture/query-keys.test.ts'

interface Source {
  rel: string
  text: string
}

const SOURCES: Source[] = graph.files
  .filter((file) => relativeTo(graph, file) !== SELF)
  .map((file) => ({
    rel: relativeTo(graph, file),
    text: stripComments(fs.readFileSync(file, 'utf8')),
  }))

/**
 * The agent's own name, and the agent's own address.
 *
 * The client stopped asking the agent itself: it asks the layer it talks to,
 * which asks the agent in the agent's dialect and hands back the versioned
 * one. So a key that still begins with the agent's name is a key that was
 * left behind when the data moved - and a key that carries the agent's
 * address splits one answer into two slots.
 *
 * `opencode-config`, `opencode-versions` and the rest are the manager's own
 * doors, and they are about the agent's own files. Their first segment says
 * which door, not which server answered, so they are not the same thing.
 */
const AGENT_NAME = 'opencode'
const AGENT_ADDRESS = 'opcodeUrl'

// ---------------------------------------------------------------------------
// Reading the source
// ---------------------------------------------------------------------------

/** The end of the bracket that opens at `start`, or -1 when it never closes. */
function balancedEnd(text: string, start: number): number {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '[' || c === '(' || c === '{') depth++
    else if (c === ']' || c === ')' || c === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * The text of a value that starts at `from`: up to the next top-level comma.
 *
 * A statement ends at the end of its line, so the value ends there too - or the
 * reader swallows the next declaration and answers with a key that was never
 * written. A value that carries on to the next line is one whose line ends in
 * an operator, or whose next line starts with one.
 */
function valueText(text: string, from: number): string {
  let depth = 0
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === '[' || c === '(' || c === '{') {
      depth++
      continue
    }
    if (c === ']' || c === ')' || c === '}') {
      if (depth === 0) return text.slice(from, i).trim()
      depth--
      continue
    }
    if (c === ',' && depth === 0) return text.slice(from, i).trim()
    if (c === '\n' && depth === 0) {
      const line = text.slice(from, i)
      const last = line.trimEnd().slice(-1)
      const next = text.slice(i + 1).match(/^\s*(\S)/)?.[1] ?? ''
      const carriesOn = '?:|&=+.,'.includes(last) || '?:|&=+.'.includes(next)
      if (!carriesOn) return text.slice(from, i).trim()
    }
  }
  return text.slice(from).trim()
}

/** Every array literal that stands on its own in the text. */
function topLevelArrays(text: string): string[] {
  const found: string[] = []
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '[') {
      if (depth === 0) {
        const end = balancedEnd(text, i)
        if (end > 0) {
          found.push(text.slice(i, end))
          i = end - 1
          continue
        }
      }
      depth++
      continue
    }
    if (c === ']' || c === ')' || c === '}') depth--
  }
  return found
}

/** The comma-separated parts of an array literal. */
function arrayParts(literal: string): string[] {
  const body = literal.slice(1, -1)
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const c of body) {
    if ('[({'.includes(c)) depth++
    else if ('])}'.includes(c)) depth--
    if (c === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += c
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** The names a file binds, and what they are bound to. */
function bindingsOf(text: string): Map<string, Binding> {
  const found = new Map<string, Binding>()

  const constRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=/g
  let match: RegExpExecArray | null
  while ((match = constRe.exec(text)) !== null) {
    const name = match[1]!
    const value = valueText(text, match.index + match[0].length)
    if (!found.has(name)) found.set(name, { value })
  }

  const fnRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g
  while ((match = fnRe.exec(text)) !== null) {
    const name = match[1]!
    const params = match[2]!
    const brace = text.indexOf('{', match.index + match[0].length)
    if (brace < 0) continue
    const end = balancedEnd(text, brace)
    if (end < 0) continue
    const body = text.slice(brace + 1, end - 1)
    const returned = /\breturn\b/.exec(body)
    if (!returned) continue
    found.set(name, {
      value: body.slice(returned.index + returned[0].length),
      params,
      isFunction: true,
    })
  }

  return found
}

/** The names a file offers to the rest of the client. */
function exportedBindingsOf(text: string, local: Map<string, Binding>): Map<string, Binding> {
  const found = new Map<string, Binding>()
  const constRe = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
  let match: RegExpExecArray | null
  while ((match = constRe.exec(text)) !== null) {
    const binding = local.get(match[1]!)
    if (binding) found.set(match[1]!, binding)
  }
  const fnRe = /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g
  while ((match = fnRe.exec(text)) !== null) {
    const binding = local.get(match[1]!)
    if (binding) found.set(match[1]!, binding)
  }
  return found
}

const LOCAL_BINDINGS = new Map<string, Map<string, Binding>>()
const EXPORTED_BINDINGS = new Map<string, Binding>()
const FUNCTION_BINDINGS: Binding[] = []

for (const source of SOURCES) {
  const local = bindingsOf(source.text)
  LOCAL_BINDINGS.set(source.rel, local)
  for (const binding of local.values()) {
    if (binding.isFunction) FUNCTION_BINDINGS.push(binding)
  }
  for (const [name, binding] of exportedBindingsOf(source.text, local)) {
    if (!EXPORTED_BINDINGS.has(name)) EXPORTED_BINDINGS.set(name, binding)
  }
}

// ---------------------------------------------------------------------------
// Reading a key
// ---------------------------------------------------------------------------

function bindingOf(name: string, rel: string): Binding | undefined {
  return LOCAL_BINDINGS.get(rel)?.get(name) ?? EXPORTED_BINDINGS.get(name)
}

function resolveArray(literal: string, rel: string, depth: number): Shapes | null {
  let shapes: Prefix[] = [[]]
  for (const part of arrayParts(literal)) {
    const spread = /^\.\.\.\s*([A-Za-z_$][\w$]*)$/.exec(part)
    if (spread) {
      const inner = resolve(spread[1]!, rel, depth + 1)
      if (!inner) return null
      const next: Prefix[] = []
      for (const base of shapes) for (const tail of inner) next.push([...base, ...tail])
      shapes = next
      continue
    }
    const quoted = /^'([^']*)'$/.exec(part) ?? /^"([^"]*)"$/.exec(part)
    const segment = quoted ? quoted[1]! : '*'
    shapes = shapes.map((shape) => [...shape, segment])
  }
  return shapes
}

/** The shapes a written key stands for, or null when the gate cannot read it. */
function resolve(expr: string, rel: string, depth = 0): Shapes | null {
  if (depth > 8) return null
  const text = expr.trim()
  if (!text) return null

  const literals = topLevelArrays(text)
  if (literals.length > 0 && text.startsWith('[')) {
    const shapes: Shapes = []
    for (const literal of literals) {
      const resolved = resolveArray(literal, rel, depth + 1)
      if (resolved) shapes.push(...resolved)
    }
    return shapes.length ? shapes : null
  }

  const name = /^([A-Za-z_$][\w$]*)\s*(\(|$)/.exec(text)
  if (name) {
    const binding = bindingOf(name[1]!, rel)
    if (!binding) return null
    if (binding.isFunction) {
      const shapes: Shapes = []
      for (const literal of topLevelArrays(binding.value)) {
        const resolved = resolveArray(literal, rel, depth + 1)
        if (resolved) shapes.push(...resolved)
      }
      return shapes.length ? shapes : null
    }
    return resolve(binding.value, rel, depth + 1)
  }

  // A ternary, or anything else that holds more than one shape.
  const shapes: Shapes = []
  for (const literal of topLevelArrays(text)) {
    const resolved = resolveArray(literal, rel, depth + 1)
    if (resolved) shapes.push(...resolved)
  }
  return shapes.length ? shapes : null
}

// ---------------------------------------------------------------------------
// Finding the places where a key is written and the places where it is refreshed
// ---------------------------------------------------------------------------

interface Call {
  body: string
  at: number
}

function calls(text: string, name: string): Call[] {
  const found: Call[] = []
  const re = new RegExp(`\\b${name}(?:<[^<>]*(?:<[^<>]*>[^<>]*)*>)?\\s*\\(`, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const open = match.index + match[0].length - 1
    const end = balancedEnd(text, open)
    if (end < 0) continue
    found.push({ body: text.slice(open + 1, end - 1), at: open })
    re.lastIndex = end
  }
  return found
}

const WRITE_CALLS = ['useQuery', 'useQueries', 'useSuspenseQuery', 'prefetchQuery', 'ensureQueryData']
const WRITE_SITES: Site[] = []
const REFRESH_SITES: Site[] = []
/** The predicates that decide which cached things a refresh reaches. */
const PREDICATES: { rel: string; line: number; text: string }[] = []

for (const source of SOURCES) {
  const line = (at: number) => source.text.slice(0, at).split('\n').length

  for (const call of calls(source.text, 'invalidateQueries')) {
    const key = /queryKey\s*:/.exec(call.body)
    if (key) {
      const expr = valueText(call.body, key.index + key[0].length)
      if (expr) {
        REFRESH_SITES.push({
          rel: source.rel,
          line: line(call.at),
          expr,
          shapes: resolve(expr, source.rel),
        })
      }
    }
    const predicate = /\bpredicate\s*:/.exec(call.body)
    if (predicate) {
      const expr = valueText(call.body, predicate.index + predicate[0].length)
      if (expr) {
        // A predicate is often a name of its own; the text it stands for is
        // what decides what the refresh reaches.
        const name = /^([A-Za-z_$][\w$]*)$/.exec(expr.trim())
        const binding = name ? bindingOf(name[1]!, source.rel) : undefined
        PREDICATES.push({
          rel: source.rel,
          line: line(call.at),
          text: binding ? binding.value : expr,
        })
      }
    }
  }

  for (const name of WRITE_CALLS) {
    for (const call of calls(source.text, name)) {
      const key = /queryKey\s*:/.exec(call.body)
      if (!key) continue
      const expr = valueText(call.body, key.index + key[0].length)
      if (!expr) continue
      WRITE_SITES.push({
        rel: source.rel,
        line: line(call.at),
        expr,
        shapes: resolve(expr, source.rel),
      })
    }
  }

  for (const call of calls(source.text, 'setQueryData')) {
    const expr = valueText(call.body, 0)
    if (!expr) continue
    WRITE_SITES.push({
      rel: source.rel,
      line: line(call.at),
      expr,
      shapes: resolve(expr, source.rel),
    })
  }

  for (const call of calls(source.text, 'setQueriesData')) {
    const key = /queryKey\s*:/.exec(call.body)
    if (!key) continue
    const expr = valueText(call.body, key.index + key[0].length)
    if (!expr) continue
    WRITE_SITES.push({
      rel: source.rel,
      line: line(call.at),
      expr,
      shapes: resolve(expr, source.rel),
    })
  }
}

/**
 * Whether a refresh reaches a write.
 *
 * React-query matches by prefix: the key that is refreshed must be the
 * beginning of the key that was written. A slot whose value is not spelled
 * out cannot confirm the match, so it does not count.
 */
function reaches(refresh: Prefix, write: Prefix): boolean {
  if (write.length < refresh.length) return false
  for (let i = 0; i < refresh.length; i++) {
    const asked = refresh[i]!
    const written = write[i]!
    if (asked === '*') continue
    if (written === '*') return false
    if (asked !== written) return false
  }
  return true
}

function prefixText(prefix: Prefix): string {
  return `[${prefix.map((segment) => (segment === '*' ? '*' : `'${segment}'`)).join(', ')}]`
}

/**
 * Every line of the client that speaks the agent's name, with the line it is
 * on and whether that line is talking about a key.
 */
function linesNamingTheAgent(): { rel: string; line: number; text: string; aboutKey: boolean }[] {
  const found: { rel: string; line: number; text: string; aboutKey: boolean }[] = []
  const literal = new RegExp(`(['"\`])${AGENT_NAME}\\1`)
  for (const source of SOURCES) {
    source.text.split('\n').forEach((text, index) => {
      if (!literal.test(text)) return
      found.push({
        rel: source.rel,
        line: index + 1,
        text: text.trim(),
        aboutKey: /querykey|\bkey\s*\[/i.test(text),
      })
    })
  }
  return found
}

describe('键只有一把，失效都落在真东西上', () => {
  it('门禁自己看得见东西', () => {
    // A rule over a set that is empty passes forever without protecting
    // anything, so the sets themselves have to be asserted.
    expect(WRITE_SITES.length, '一个写入点都没扫到，这道门禁没有判别力').toBeGreaterThan(60)
    expect(REFRESH_SITES.length, '一个失效点都没扫到，这道门禁没有判别力').toBeGreaterThan(60)

    // The gate has to be able to read a key that is written as a name, not
    // only as a literal - or the keys that have owners look unreadable.
    const named = WRITE_SITES.filter((site) => !site.expr.startsWith('['))
    expect(named.length, '一个具名的键都没扫到，门禁读不懂有主人的键').toBeGreaterThan(10)
    expect(
      named.filter((site) => site.shapes !== null).length,
      '具名的键一个都读不出来，门禁读不懂有主人的键',
    ).toBeGreaterThan(10)

    // And it has to know a key when it sees one.
    expect(resolve("['mcp', 'servers']", 'lib/queryInvalidation.ts'), '认不出一个键').toEqual([
      ['mcp', 'servers'],
    ])
    expect(resolve('MCP_SERVERS_KEY', 'hooks/useMcpServers.ts'), '认不出有主人的键').toEqual([
      ['mcp', 'servers'],
    ])
  })

  it('每一处失效都落在真东西上，不许刷新一个没人写过的槽位', () => {
    const offenders: string[] = []

    for (const site of REFRESH_SITES) {
      if (!site.shapes || site.shapes.length === 0) {
        offenders.push(`${site.rel}:${site.line}  读不懂这个键  ${site.expr.replace(/\s+/g, ' ')}`)
        continue
      }
      for (const shape of site.shapes) {
        const found = WRITE_SITES.some((write) =>
          write.shapes?.some((written) => reaches(shape, written)),
        )
        if (!found) {
          offenders.push(
            `${site.rel}:${site.line}  刷新了没人写过的槽位  ${prefixText(shape)}  ${site.expr.replace(/\s+/g, ' ')}`,
          )
        }
      }
    }

    expect(
      offenders,
      [
        '这些失效刷新的是没有人写过的槽位，所以它们什么也没做：',
        ...offenders,
        '键搬了家、名字没搬，就是这个样子。',
      ].join('\n'),
    ).toEqual([])
  })

  it('客户端的键里不许再有 agent', () => {
    const offenders: string[] = []

    for (const site of [...WRITE_SITES, ...REFRESH_SITES]) {
      if (site.expr.includes(AGENT_ADDRESS)) {
        offenders.push(
          `${site.rel}:${site.line}  键里带着 agent 的地址  ${site.expr.replace(/\s+/g, ' ')}`,
        )
      }
      for (const shape of site.shapes ?? []) {
        if (shape[0] === AGENT_NAME) {
          offenders.push(`${site.rel}:${site.line}  键还以 agent 的名字开头  ${prefixText(shape)}`)
        }
      }
    }

    for (const predicate of PREDICATES) {
      if (predicate.text.includes(AGENT_NAME)) {
        offenders.push(`${predicate.rel}:${predicate.line}  谓词还在拿 agent 的名字比键`)
      }
      if (predicate.text.includes(AGENT_ADDRESS)) {
        offenders.push(`${predicate.rel}:${predicate.line}  谓词里还带着 agent 的地址`)
      }
    }

    for (const binding of FUNCTION_BINDINGS) {
      if (!binding.params?.includes(AGENT_ADDRESS)) continue
      if (topLevelArrays(binding.value).length === 0) continue
      offenders.push(`发号的那把钥匙收了 agent 的地址：${binding.params?.trim()}`)
    }

    // And the plain reading of a key: a line that says the agent's name next
    // to a key is a line that still believes the agent owns that slot.
    for (const found of linesNamingTheAgent()) {
      if (!found.aboutKey) continue
      offenders.push(`${found.rel}:${found.line}  这一行还在拿 agent 的名字说键  ${found.text}`)
    }

    expect(
      offenders,
      [
        '客户端已经不跟 agent 直接要东西了，键里不许再有它：',
        ...offenders,
      ].join('\n'),
    ).toEqual([])
  })

  it('一份数据只有一把钥匙', () => {
    // A key is a name, and a name that is written twice is two names waiting
    // to drift apart. The catalogue had two: `['providers']` and the one the
    // layer's own name spells, so a refresh of one left the other stale.
    //
    // The shape of the thing is the same: one name is the other with a
    // namespace put in front of it. Only a name that is written out in full
    // counts - a slot whose value is not spelled out is not a name yet.
    const names = new Map<string, string>()
    for (const site of [...WRITE_SITES, ...REFRESH_SITES]) {
      for (const shape of site.shapes ?? []) {
        if (shape.some((segment) => segment === '*')) continue
        names.set(shape.join(' '), prefixText(shape))
      }
    }

    const offenders: string[] = []
    for (const [key, printed] of names) {
      const shape = key.split(' ')
      for (const [otherKey, otherPrinted] of names) {
        if (otherKey === key) continue
        const other = otherKey.split(' ')
        if (other.length !== shape.length + 1) continue
        if (other.slice(1).join(' ') !== key) continue
        offenders.push(`${otherPrinted} 与 ${printed} 是同一份数据的两个名字`)
      }
    }

    expect(
      offenders,
      ['一份数据只许有一个名字：', ...offenders].join('\n'),
    ).toEqual([])
  })
})
