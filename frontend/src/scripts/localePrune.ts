/**
 * Removes named keys from a locale file and nothing else.
 *
 * It exists because there are translation keys nothing renders, and every
 * version of the script written to clear them out has been wrong in a way
 * that only showed up when it was pointed at the real files:
 *
 *   - it did not see `export const en = {`, so keys came out one level short
 *   - it deleted the key line of a value that continued on the next line,
 *     leaving the string behind as an orphan
 *   - it treated `account: { label: 'a', description: 'b' },` as a leaf, so
 *     `label` and `description` were invisible and deleting the parent took
 *     two live strings with it
 *
 * A tool that rewrites locale files by line number has to be trustworthy
 * before it is pointed at them, hence prune.test.ts beside it - and the i18n
 * gate is the independent oracle, because it reads the real bundle instead of
 * trusting this index. That is how the third one was caught.
 *
 * The namespace is passed in rather than guessed: most locale files are named
 * after their namespace, and guessing is how the first version broke.
 */

const GROUP_OPEN = /^(\s*)([A-Za-z_$][\w$]*):\s*\{\s*$/
const GROUP_CLOSE = /^(\s*)\},?\s*$/
const LEAF = /^(\s*)([A-Za-z_$][\w$]*):(.*)$/
/** `name: { a: 1, b: 2 },` - a whole group on one line */
const INLINE_GROUP = /^(\s*)([A-Za-z_$][\w$]*):\s*\{(.*)\},?\s*$/
/** `export const en = {` - the wrapper the first version did not see */
const ROOT_OPEN = /^(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*\{\s*$/

/** The `name: value` pairs inside a one-line group body. Values in these files
 *  are quoted strings, so splitting on a comma that is not inside quotes is
 *  enough - and a string containing a comma would need the quote tracking,
 *  which is why it is here. */
function inlineEntries(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '{' || ch === '[' || ch === '(') depth++
    else if (ch === '}' || ch === ']' || ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      out.push(body.slice(start, i))
      start = i + 1
    }
  }
  const last = body.slice(start).trim()
  if (last) out.push(last)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** dotted key -> line index of its declaration */
export function buildKeyIndex(source: string, namespace: string): Record<string, number> {
  const index: Record<string, number> = {}
  // Pushed by hand. Without it every key comes out one level short.
  const stack: string[] = namespace ? [namespace] : []

  source.split('\n').forEach((line, i) => {
    if (ROOT_OPEN.test(line)) return
    const open = GROUP_OPEN.exec(line)
    if (open) {
      stack.push(open[2]!)
      return
    }
    const close = GROUP_CLOSE.exec(line)
    if (close && stack.length > (namespace ? 1 : 0)) {
      stack.pop()
      return
    }
    const inline = INLINE_GROUP.exec(line)
    if (inline) {
      // index what is inside, or deleting the parent line would take live
      // keys with it and nothing would notice
      const prefix = [...stack, inline[2]!]
      for (const entry of inlineEntries(inline[3]!)) {
        const name = /^([A-Za-z_$][\w$]*):/.exec(entry)
        if (name) index[[...prefix, name[1]!].join('.')] = i
      }
      index[[...stack, inline[2]!].join('.')] = i
      return
    }
    const leaf = LEAF.exec(line)
    if (leaf) index[[...stack, leaf[2]!].join('.')] = i
  })

  return index
}

/** Every line the entry starting at `from` occupies, up to and including the
 *  line whose value is finished. Values wrap, so a key line is not enough. */
function entryLines(lines: string[], from: number): number[] {
  const taken = [from]
  const leaf = LEAF.exec(lines[from]!)
  if (!leaf || leaf[3]!.trim().endsWith(',')) return taken
  // the value continues: take lines until one ends it
  for (let i = from + 1; i < lines.length; i++) {
    taken.push(i)
    if (lines[i]!.trimEnd().endsWith(',')) return taken
  }
  return taken
}

export function pruneKeys(source: string, keys: readonly string[], namespace: string): string {
  if (keys.length === 0) return source
  const lines = source.split('\n')
  const index = buildKeyIndex(source, namespace)

  const drop = new Set<number>()
  for (const key of keys) {
    const at = index[key]
    // A key that is not in this file's namespace is not ours to remove.
    if (at === undefined) continue
    // A key declared inside a one-line group cannot be removed on its own;
    // skipping it is better than taking its neighbours with it.
    if (INLINE_GROUP.test(lines[at]!)) continue
    for (const line of entryLines(lines, at)) drop.add(line)
  }
  if (drop.size === 0) return source

  let kept = lines.filter((_, i) => !drop.has(i))

  // A group whose body is now blank goes with its children, so we never
  // leave `onlyOne: {}` behind in a translation file.
  for (;;) {
    const empties: Array<[number, number]> = []
    kept.forEach((line, i) => {
      const open = GROUP_OPEN.exec(line)
      if (!open) return
      const indent = open[1]!.length
      for (let j = i + 1; j < kept.length; j++) {
        const close = GROUP_CLOSE.exec(kept[j]!)
        if (!close || close[1]!.length !== indent) continue
        if (kept.slice(i + 1, j).every((l) => !l.trim())) empties.push([i, j])
        return
      }
    })
    if (empties.length === 0) break
    const skip = new Set<number>()
    for (const [i, j] of empties) for (let k = i; k <= j; k++) skip.add(k)
    kept = kept.filter((_, i) => !skip.has(i))
  }

  return kept.join('\n')
}
