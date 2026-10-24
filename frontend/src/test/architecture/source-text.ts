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
      parts.push(expression.slice(index + 1, end))
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
  if (value.quoted) return value.text.replace(/\s+/g, ' ').trim()
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
