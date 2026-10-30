/**
 * Reading source text without being fooled by it.
 *
 * Two things in a source file are not code: a comment, and the inside of a
 * string. A gate that reads the file as one flat string sees both, and a
 * rule about class names or colours then fires on prose.
 *
 * The scanner here exists because the obvious regex does not work: a
 * Tailwind class list can contain a quote of its own
 * (`[&_svg:not([class*='size-'])]:size-4`), so "everything up to the next
 * quote" is not a string. The only way to read one is to walk the text and
 * remember which quote opened it.
 */

/**
 * Comments out, keeping the line count.
 *
 * The line count matters: a gate that reports "file:line" has to be able to
 * point at the line the offending code is on, and replacing a comment with
 * a single space would move everything after it.
 */
export function stripComments(text: string): string {
  return (
    text
      // Block comments, including the JSX form. Newlines are kept, so the
      // line numbers of the code after the comment do not move.
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
      // Line comments. The `[^:]` in front keeps the `//` in a URL: the URL
      // really is in this file, and a stripper that ate it would corrupt
      // the source it is being asked to inspect.
      .replace(
        /(^|[^:])\/\/[^\n]*/g,
        (match, lead: string) => lead + ' '.repeat(match.length - lead.length),
      )
  )
}

/**
 * The characters a string literal can be preceded by.
 *
 * A quote in the middle of a word is an apostrophe in prose - "don't" - and
 * treating it as the start of a string would run the literal all the way to
 * the next apostrophe in the file, swallowing whatever is in between.
 */
const STRING_CAN_PRECEDE = new Set([
  '=',
  '(',
  '[',
  '{',
  ',',
  ':',
  '>',
  '&',
  '|',
  '!',
  '?',
  '+',
  '~',
  '"',
  "'",
  '`',
])

/**
 * From a tag to the `>` that ends it.
 *
 * Two things can sit inside a tag without ending it: a quoted string, and a
 * brace - an arrow function in a handler (`onChange={(e) => set(e.target.value)}`)
 * has a `>` in it, and a scanner that stops at the first `>` reads half a tag
 * and misses the class name that comes after it.
 */
export function tagAt(text: string, start: number): string {
  let quote: string | null = null
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      continue
    }
    if (char === '>' && depth === 0) return text.slice(start, index + 1)
  }
  return text.slice(start)
}

/**
 * An attribute's value.
 *
 * A quoted value ends at its quote; a braced one ends at the brace that closes
 * it - `{cn("…", x)}` holds quotes of its own, and a scanner that stops at the
 * first `}` reads half the attribute.
 */
export function attributeValue(
  text: string,
  start: number,
): { quoted: boolean; text: string } | null {
  const first = text[start]
  if (first === '"' || first === "'" || first === '`') {
    const end = text.indexOf(first, start + 1)
    if (end < 0) return null
    return { quoted: true, text: text.slice(start + 1, end) }
  }
  if (first === '{') {
    let depth = 0
    for (let index = start; index < text.length; index += 1) {
      const char = text[index]
      if (char === '{') {
        depth += 1
        continue
      }
      if (char === '}') {
        depth -= 1
        if (depth === 0) return { quoted: false, text: text.slice(start + 1, index) }
      }
    }
  }
  return null
}

/**
 * A constant's value, wherever it is written.
 *
 * Two spellings: a plain string (`const SURFACE_CLASS = '…'`) and a call that
 * wraps one (`const buttonVariants = cva('…', {…})`). Both have to be found -
 * the size of a button lives in the second one.
 */
export function constValue(text: string, identifier: string): string | undefined {
  const match = new RegExp(`\\bconst\\s+${identifier}\\s*=`).exec(text)
  if (!match) return undefined
  const rest = text.slice(match.index + match[0].length)

  const quoted = /^\s*(['"`])([\s\S]*?)\1/.exec(rest)
  if (quoted) return quoted[2]

  const open = rest.indexOf('(')
  if (open < 0) return undefined
  let depth = 0
  let end = open
  for (; end < rest.length; end += 1) {
    if (rest[end] === '(') depth += 1
    else if (rest[end] === ')') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const first = /(['"`])([\s\S]*?)\1/.exec(rest.slice(open + 1, end))
  return first?.[2]
}

/**
 * The class names a computed `className` asks for.
 *
 * Two things live in there: quoted strings, which are class names outright,
 * and bare names, which are names of constants somewhere else in the file -
 * `className={cn('…', SURFACE_CLASS)}` asks for the words inside the quotes
 * *and* for whatever `SURFACE_CLASS` was given. Only the caller knows where
 * that constant was given its value, so `resolve` is asked for it.
 */
function classNamesOfExpression(
  expression: string,
  resolve?: (identifier: string) => string | undefined,
): string {
  const parts: string[] = []
  let index = 0
  while (index < expression.length) {
    const char = expression[index]!
    if (char === '"' || char === "'" || char === '`') {
      const end = expression.indexOf(char, index + 1)
      if (end < 0) break
      const literal = expression.slice(index + 1, end)
      // **模板字符串** ✓：它里面插进来的那些 ✓ 也要读 ✓。
      parts.push(char === '`' ? templateClasses(literal) : literal)
      index = end + 1
      continue
    }
    if (/[A-Za-z_$]/.test(char)) {
      let end = index
      while (end < expression.length && /[\w$]/.test(expression[end]!)) end += 1
      const resolved = resolve?.(expression.slice(index, end))
      if (resolved !== undefined) parts.push(resolved)
      index = end
      continue
    }
    index += 1
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Where an attribute of its own begins.
 *
 * Only the tag's *own* attributes count. An attribute can hold a piece of
 * markup - `actions={<div className="text-sm">…</div>}` - and the class name
 * in there belongs to that div, not to the tag being asked about. So the scan
 * keeps track of the braces and the quotes: an attribute name is one that
 * stands at the top level, outside both.
 */
function ownAttributeAt(text: string, name: string): number | null {
  let depth = 0
  let quote: string | null = null
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      continue
    }
    if (depth !== 0) continue
    if (!text.startsWith(name, index)) continue
    const before = text[index - 1]
    if (before && /[\w$]/.test(before)) continue
    const after = text[index + name.length]
    if (after && /[\w$]/.test(after)) continue
    let cursor = index + name.length
    while (cursor < text.length && /\s/.test(text[cursor]!)) cursor += 1
    if (text[cursor] !== '=') continue
    return index
  }
  return null
}

/**
 * The class names a template literal asks for.
 *
 * `className={`p-2 ${open ? "rounded-none" : "rounded-r-lg"}`}` is two decisions
 * written as one list: the words that are always there, and the words one of
 * the branches adds. Read as one flat string, the branches stay inside it -
 * `"rounded-none"` with its quotes - and a rule about class names then sees a
 * word nobody wrote.
 */
function templateClasses(text: string): string {
  const parts: string[] = []
  let words = ''
  let index = 0
  while (index < text.length) {
    if (text.startsWith('${', index)) {
      if (words) {
        parts.push(words)
        words = ''
      }
      let depth = 0
      let cursor = index + 1
      for (; cursor < text.length; cursor += 1) {
        const char = text[cursor]
        if (char === '{') depth += 1
        else if (char === '}') {
          depth -= 1
          if (depth === 0) break
        }
      }
      parts.push(classNamesOfExpression(text.slice(index + 2, cursor)))
      index = cursor + 1
      continue
    }
    words += text[index]
    index += 1
  }
  if (words) parts.push(words)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * The class names a piece of markup asks for.
 *
 * `className="…"` is literal. `className={…}` is computed, and the class names
 * in it are the quoted strings - `className={cn("flex h-9 …", className)}` asks
 * for the words inside the quotes, not for the word `cn`.
 */
export function classListOfAttrs(
  text: string,
  resolve?: (identifier: string) => string | undefined,
): string {
  const at = ownAttributeAt(text, 'className')
  if (at === null) return ''
  const equals = text.indexOf('=', at)
  const value = attributeValue(text, equals + 1)
  if (!value) return ''
  if (value.quoted) {
    // **模板字符串** ✓：它里面插进来的那些 ✓ 也要读 ✓。
    if (text[equals + 1] === '`') return templateClasses(value.text)
    return value.text.replace(/\s+/g, ' ').trim()
  }
  return classNamesOfExpression(value.text, resolve)
}

/**
 * The class names a set of tags brings.
 *
 * `className="…"` and `className={…}` both count, and the expression's own
 * quoted strings are read as class names - a rule about class lists is about
 * what the component asked for, however it asked for it.
 */
export function classListOfTag(
  text: string,
  tag: string,
  resolve?: (identifier: string) => string | undefined,
): string[] {
  const found: string[] = []
  const matcher = new RegExp(`<${tag}\\b`, 'g')
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text)) !== null) {
    const opening = tagAt(text, match.index)
    const attrs = opening.slice(tag.length + 1, opening.endsWith('>') ? -1 : undefined)
    found.push(classListOfAttrs(attrs, resolve))
  }
  return found
}

/**
 * The class names the first tag of a piece of code asks for.
 *
 * A shared part is a function, and its class names are not on a tag - they
 * are on the element it draws. So the element is looked for, rather than the
 * first `className` in the whole piece of code: the braces of the function
 * itself would bury the element inside them.
 */
export function firstClassListOf(
  text: string,
  resolve?: (identifier: string) => string | undefined,
): string {
  const matcher = /<[A-Za-z][\w.]*/g
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text)) !== null) {
    const opening = tagAt(text, match.index)
    const tagName = /<([A-Za-z][\w.]*)/.exec(opening)?.[1] ?? ''
    const attrs = opening.slice(tagName.length + 1, opening.endsWith('>') ? -1 : undefined)
    const list = classListOfAttrs(attrs, resolve)
    if (list) return list
  }
  return ''
}

function isStringStart(text: string, index: number): boolean {
  let before = index - 1
  while (before >= 0 && /\s/.test(text[before]!)) before -= 1
  if (before < 0) return true
  return STRING_CAN_PRECEDE.has(text[before]!)
}

/**
 * Every string literal in the text.
 *
 * The quote that opened the literal is the quote that closes it, so a
 * literal that contains the other kind of quote is read whole.
 */
export function stringLiterals(text: string): string[] {
  const literals: string[] = []
  let index = 0
  while (index < text.length) {
    const char = text[index]!
    const opens = char === '"' || char === "'" || char === '`'
    if (!opens || !isStringStart(text, index)) {
      index += 1
      continue
    }
    const quote = char
    let cursor = index + 1
    let value = ''
    while (cursor < text.length) {
      const current = text[cursor]!
      if (current === '\\') {
        value += text[cursor + 1] ?? ''
        cursor += 2
        continue
      }
      if (current === quote) break
      value += current
      cursor += 1
    }
    literals.push(value)
    index = cursor + 1
  }
  return literals
}

/**
 * A call's first argument.
 *
 * `cva('…')` and `cn('…')` are where a part says what it looks like, and a
 * rule about a part's face has to read that place - not the first string
 * literal in the file, which might be a colour or a label.
 */
export function firstArgumentOf(text: string, callee: string): string | null {
  const at = text.indexOf(`${callee}(`)
  if (at < 0) return null
  let index = at + callee.length + 1
  while (index < text.length && /\s/.test(text[index]!)) index += 1
  const quote = text[index]
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, index + 1)
    return end < 0 ? null : text.slice(index + 1, end)
  }
  if (quote === '`') {
    let cursor = index + 1
    while (cursor < text.length) {
      if (text[cursor] === '\\') {
        cursor += 2
        continue
      }
      if (text[cursor] === '`') break
      cursor += 1
    }
    return text.slice(index + 1, cursor)
  }
  return null
}

/**
 * The class list a part says it wears.
 *
 * A part that keeps its face in a constant writes `cva(\`… ${FIELD_FACE} …\`)`
 * or `cn(\`… ${FIELD_FACE} …\`)`, so the constant has to be put back before
 * the list can be judged - otherwise the rule sees a placeholder where the
 * face should be.
 */
export function ownListOf(text: string, constants?: Map<string, string>): string {
  const own = firstArgumentOf(text, 'cva') ?? firstArgumentOf(text, 'cn') ?? ''
  if (!constants) return own
  return own.replace(/\$\{(\w+)\}/g, (whole, name) => constants.get(name) ?? whole)
}

/**
 * The size steps a part declares.
 *
 * `cva(…, { variants: { size: { sm: "h-8 …", … } } })` is where a part says
 * what each step of its ladder looks like, and a rule about the ladder has to
 * read it from there. The same is true of the `variant:` group - the face a
 * button wears.
 */
export function variantsOf(
  text: string,
  key = 'size',
  declaration?: string,
): Map<string, string> {
  const found = new Map<string, string>()
  // A named declaration that is not there means *nothing*: falling back to the
  // first group would read another part's variants and call them its own.
  if (declaration) {
    const at = text.indexOf(`const ${declaration} = cva(`)
    if (at < 0) return found
    return groupOf(text.slice(at), key, found)
  }
  const at = text.indexOf(`${key}: {`)
  if (at < 0) return found
  return groupOf(text.slice(at), key, found)
}

/** The group of variants that starts at the beginning of the text. */
function groupOf(text: string, key: string, found: Map<string, string>): Map<string, string> {
  const at = text.indexOf(`${key}: {`)
  if (at < 0) return found
  let depth = 0
  let end = at
  for (; end < text.length; end += 1) {
    if (text[end] === '{') depth += 1
    else if (text[end] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const body = text.slice(at, end)
  for (const match of body.matchAll(/"?([\w-]+)"?:\s*"([^"]*)"/g)) {
    found.set(match[1]!, match[2]!)
  }
  return found
}

/**
 * The steps a plain record offers.
 *
 * `const DIALOG_CONTENT_HEIGHTS = { short: "…", tall: "…" } as const` is where a
 * part says what it has to offer - a ladder of sizes that is not a face, so it
 * is not written with `cva`. A rule about that ladder has to read it from
 * there, the same way `variantsOf` reads the faces.
 */
export function recordOf(text: string, identifier: string): Map<string, string> {
  const found = new Map<string, string>()
  const at = text.indexOf(`const ${identifier} =`)
  if (at < 0) return found
  const open = text.indexOf('{', at)
  if (open < 0) return found
  let depth = 0
  let end = open
  for (; end < text.length; end += 1) {
    const char = text[end]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const body = text.slice(open, end)
  // **两种引号都认** ✓——有的文件用单引号 ✓，有的用双引号 ✓。
  for (const match of body.matchAll(/"?([\w-]+)"?\s*:\s*["']([^"']*)["']/g)) {
    found.set(match[1]!, match[2]!)
  }
  return found
}

/**
 * The height a class list asks for on each screen size.
 *
 * The key is the breakpoint - the empty string is the ordinary one - and the
 * value is in pixels. `h-8 md:h-9` is 32 everywhere and 36 from `md` up.
 */
export function heightsFrom(list: string): Map<string, number> {
  const heights = new Map<string, number>()
  for (const token of list.split(/\s+/)) {
    if (!token) continue
    const match = /^(?:([a-z0-9]+):)?(?:h|size)-(\d+)$/.exec(token)
    if (!match) continue
    heights.set(match[1] ?? '', Number(match[2]) * 4)
  }
  return heights
}

/**
 * The screens, from the narrowest to the widest.
 *
 * The empty key is the ordinary one - the width below the first breakpoint.
 */
export const BREAKPOINTS = ['', 'sm', 'md', 'lg', 'xl', '2xl']

/**
 * Which of several height stories wins on a given screen.
 *
 * The stylesheet is ordered by breakpoint, so on a 768px screen the `md:`
 * rule is the one that applies - it comes after the `sm:` one. On the same
 * breakpoint the call site's own rule wins: it is written last.
 */
export function effectiveKey(stories: Map<string, number>[], width: string): string | null {
  const limit = BREAKPOINTS.indexOf(width)
  let best = -1
  let key: string | null = null
  for (const story of stories) {
    for (const candidate of story.keys()) {
      const at = BREAKPOINTS.indexOf(candidate)
      if (at < 0 || at > limit) continue
      if (at <= best) continue
      best = at
      key = candidate
    }
  }
  return key
}

/** What a set of height stories says on a given screen. */
export function heightOf(stories: Map<string, number>[], width: string): number | null {
  const key = effectiveKey(stories, width)
  if (key === null) return null
  for (let index = stories.length - 1; index >= 0; index -= 1) {
    const story = stories[index]!
    if (story.has(key)) return story.get(key)!
  }
  return null
}

/**
 * 某一个 cva 声明自己的底子。
 *
 * `const dialogFooterVariants = cva("…", …)` 的那个字符串——共享零件的类名
 * 现在住在那里，不在它的 `cn(...)` 里了。
 */
export function cvaBase(text: string, declaration: string): string {
  const at = text.indexOf(`const ${declaration} = cva(`)
  if (at < 0) return ''
  // 底子可以是引号里的字面量，也可以是反引号里的模板字符串——
  // 共享的按钮就写着后者，只认引号的话，它就"读不出自己的底子"。
  const quoted =
    /cva\(\s*(?:'([^']*)'|"([^"]*)"|`([\s\S]*?)`)/.exec(text.slice(at))
  return quoted?.[1] ?? quoted?.[2] ?? quoted?.[3] ?? ''
}

/**
 * The icon names a file brought in.
 *
 * An icon is not whatever happens to start with a capital letter - it is what
 * came from the icon library. A rule about icons has to tell the two apart,
 * or it ends up ruling about buttons and cards in a button's name.
 */
export function iconNames(text: string): Set<string> {
  const names = new Set<string>()
  for (const match of text.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g,
  )) {
    for (const piece of match[1]!.split(',')) {
      const name = piece.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
  }
  return names
}

/**
 * The size `field-text` asks for on a phone.
 *
 * It is the floor for anything you can type into: a phone enlarges an input
 * with a smaller font and does not shrink it back, so the app puts 16px in
 * there. A rule about how tall a field has to be measures against it.
 */
export function fieldTextPhonePx(css: string): number {
  const utility = /@utility\s+field-text\s*\{([\s\S]*?)\n\}/.exec(css)?.[1]
  if (!utility) return 0
  const rem = Number(/font-size:\s*([\d.]+)rem/.exec(utility)?.[1] ?? '0')
  return Math.round(rem * 16 * 100) / 100
}

/**
 * Reading the shape of a JSX tree out of source text.
 *
 * A rule about "a block that says something" has to know what is inside that
 * block, and where the block sits - a message at the top of a list is a state,
 * the same words under a label are a caption. Reading that out of source text
 * with a regular expression is not possible: the markup nests, and the tags
 * that open it are not written the same way every time.
 *
 * So this is a small parser. It walks the text, remembers every element it
 * opens, and closes them the way the source closes them. It is deliberately
 * forgiving: anything it cannot make sense of is simply not an element, and
 * the rules built on top of it ask structural questions rather than counting
 * tags.
 */

export interface JsxElement {
  /** The tag as written: `div`, `PanelMessage`, `CardContent`. */
  name: string
  /** The class names the element asked for, however it asked for them. */
  classes: string
  /** The whole opening tag, so that attributes like `role` can be read. */
  opening: string
  /** Where the element starts in the text. */
  start: number
  /** Where the content starts - just after the opening tag. */
  contentStart: number
  /** Where the closing tag starts; -1 when the element was never closed. */
  end: number
  /** The elements directly inside this one. */
  children: JsxElement[]
  /** The element directly around this one. */
  parent: JsxElement | null
}

/**
 * What may stand in front of a tag.
 *
 * `<` also shows up in comparisons - `a < b` - and in a generic type. Those
 * are not tags, and a parser that treats them as tags loses its place in the
 * tree from that point on. A real tag is written after whitespace, an opening
 * bracket, a brace, an arrow or the end of an expression.
 */
const MAY_PRECEDE_A_TAG = /[\s(,{[=>;}]/

/**
 * Every element in the text, with the shape it is written in.
 *
 * The close of an element is found by name: the source closes what it opens.
 * A tag whose name never comes back is left open, and the rules that ask
 * about its content then see nothing - which is the honest answer for
 * markup this parser does not understand.
 */
export function elementTree(text: string): JsxElement[] {
  const all: JsxElement[] = []
  const open: JsxElement[] = []
  const matcher = /<(\/?)([A-Za-z][\w]*(?:\.[A-Za-z][\w]*)*)\b/g
  let match: RegExpExecArray | null

  while ((match = matcher.exec(text)) !== null) {
    const before = match.index === 0 ? ' ' : text[match.index - 1]!
    if (!MAY_PRECEDE_A_TAG.test(before)) continue

    const name = match[2]!

    if (match[1] === '/') {
      // The source closes what it opens: find the element this close belongs
      // to and close it.
      for (let index = open.length - 1; index >= 0; index -= 1) {
        const element = open[index]!
        if (element.name !== name) continue
        element.end = match.index
        open.length = index
        break
      }
      continue
    }

    const opening = tagAt(text, match.index)
    const attributes = opening.slice(name.length + 1, opening.endsWith('>') ? -1 : undefined)
    const element: JsxElement = {
      name,
      classes: classListOfAttrs(attributes),
      opening,
      start: match.index,
      contentStart: match.index + opening.length,
      end: -1,
      children: [],
      parent: open.length ? open[open.length - 1]! : null,
    }

    if (element.parent) element.parent.children.push(element)

    all.push(element)

    if (!/\/\s*>$/.test(opening)) open.push(element)
  }

  return all
}

/** An element and everything inside it. */
export function familyOf(element: JsxElement): JsxElement[] {
  const family: JsxElement[] = []
  const pending = [...element.children]
  while (pending.length > 0) {
    const child = pending.shift()!
    family.push(child)
    pending.push(...child.children)
  }
  return family
}

/** The text between an element's tags. */
export function contentOf(text: string, element: JsxElement): string {
  if (element.end < 0) return ''
  return text.slice(element.contentStart, element.end)
}

/**
 * Whether the text is one expression and nothing else.
 *
 * `{name}` is one expression. `{name} and {other}` is two. The difference
 * matters: a block that holds one thing is a message, a block that holds a
 * sentence and a value is something else.
 */
export function isSingleExpression(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false
  let depth = 0
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return index === trimmed.length - 1
    }
  }
  return false
}

/** The expression inside `{…}`, when the content is exactly one expression. */
export function expressionIn(content: string): string | null {
  if (!isSingleExpression(content)) return null
  return content.trim().slice(1, -1).trim()
}

/**
 * A decision: the two sides of a ternary, and the right hand side of `&&`.
 *
 * These are the places where the code chooses between showing something and
 * showing something else. A block that occupies one of these places is
 * standing in for content that is not there - which is what a state is.
 */
export interface DecisionGroup {
  /** `?` for the "then" side, `:` for the "else" side, `&&` for a guard. */
  keyword: '?' | ':' | '&&'
  /** Where the group's parenthesis opens. */
  open: number
  /** Where the group's parenthesis closes. */
  close: number
  /** Where the group's content starts. */
  contentStart: number
  /** Where the group's content ends. */
  contentEnd: number
}

function groupAt(text: string, open: number): { close: number } | null {
  let depth = 0
  let quote: string | null = null
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]!
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return { close: index }
    }
  }
  return null
}

export function decisionGroups(text: string): DecisionGroup[] {
  const groups: DecisionGroup[] = []
  const matcher = /\?|&&/g
  let match: RegExpExecArray | null

  while ((match = matcher.exec(text)) !== null) {
    if (match[0] === '?' && text[match.index - 1] === '?') continue
    const keyword = match[0] as '?' | '&&'
    let cursor = match.index + keyword.length
    while (cursor < text.length && /\s/.test(text[cursor]!)) cursor += 1
    if (text[cursor] !== '(') continue

    const found = groupAt(text, cursor)
    if (!found) continue
    groups.push({
      keyword,
      open: cursor,
      close: found.close,
      contentStart: cursor + 1,
      contentEnd: found.close,
    })

    if (keyword !== '?') continue
    // The other side of the ternary.
    let other = found.close + 1
    while (other < text.length && /\s/.test(text[other]!)) other += 1
    if (text[other] !== ':') continue
    other += 1
    while (other < text.length && /\s/.test(text[other]!)) other += 1
    if (text[other] !== '(') continue
    const elseFound = groupAt(text, other)
    if (!elseFound) continue
    groups.push({
      keyword: ':',
      open: other,
      close: elseFound.close,
      contentStart: other + 1,
      contentEnd: elseFound.close,
    })
  }

  return groups
}

/**
 * The elements that sit directly inside a group.
 *
 * A group holds the markup of one branch. The elements at the top of it are
 * the ones the branch draws; anything deeper belongs to those.
 */
export function elementsIn(tree: JsxElement[], group: DecisionGroup): JsxElement[] {
  const inside = tree.filter(
    (element) =>
      element.start >= group.contentStart && element.end <= group.contentEnd && element.end > 0,
  )
  return inside.filter(
    (element) =>
      !element.parent ||
      element.parent.start < group.contentStart ||
      element.parent.end > group.contentEnd,
  )
}

/** The attribute `role` of an element, when it has one. */
export function roleOf(element: JsxElement): string | null {
  const match = /\brole="([^"]*)"/.exec(element.opening)
  return match ? match[1]! : null
}
