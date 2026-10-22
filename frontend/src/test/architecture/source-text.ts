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
