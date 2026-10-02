import { describe, expect, it } from 'vitest'
import { buildKeyIndex, pruneKeys } from './localePrune'

/**
 * The delete tool gets its own tests, because the first version of it was
 * wrong in exactly the way an untested script is: it did not see
 * `export const en = {`, so every key it indexed came out without its
 * namespace - `card.untitled` instead of `misc.card.untitled` - and 120
 * dead keys matched exactly one. It removed two lines and the i18n gate
 * went red, which is the only reason that was a near miss.
 *
 * The fixture is a miniature of the real locale files: the outer wrapper
 * that broke it, nested groups, a group that empties out, and a value that
 * contains braces.
 */

const NS = 'settingsPanels'

const LOCALE = `import { something } from './other'

export const en = {
  appName: 'OpenCode Manager',
  card: {
    untitled: 'Untitled Session',
    deleteAria: 'Delete session',
  },
  nested: {
    deep: {
      keep: 'kept',
      drop: 'dropped',
    },
    onlyOne: {
      gone: 'alone in here',
    },
  },
  braces: 'has } and { in it',
  other: 'kept too',
  // a value that continues on the next line, which is how several real keys
  // are written: the first version of this tool deleted the key line and
  // left the string behind as an orphan
  wrapped: {
    single:
      'a long sentence',
    double:
      'another long sentence',
  },
  // a whole group on one line, which is how settings.menu is written. The
  // second version of this tool read the outer name as a leaf, so label and
  // description were invisible and removing the parent took both live keys
  // with it. The i18n gate is what caught it.
  menu: {
    account: { label: 'Account', description: 'Profile' },
    git: { label: 'Git', description: 'Identity' },
  },
}
`

// The first `{` in the file belongs to the import statement, the object does
// not run to the end of the file, and values contain braces of their own -
// `braces: 'has } and { in it'` and interpolation like 'Edit {{name}}' are
// both real in these files. So skip string literals while matching.
function objectOf(source: string): Record<string, unknown> {
  const brace = source.indexOf('{', source.indexOf('export const'))
  let depth = 0
  let quote: string | null = null
  for (let i = brace; i < source.length; i++) {
    const ch = source[i]!
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return eval('(' + source.slice(brace, i + 1) + ')') as Record<string, unknown>
    }
  }
  throw new Error('no matching brace')
}

describe('buildKeyIndex', () => {
  it('prefixes every key with its namespace, including through the outer wrapper', () => {
    expect(Object.keys(buildKeyIndex(LOCALE, NS)).sort()).toEqual([
      'settingsPanels.appName',
      'settingsPanels.braces',
      'settingsPanels.card.deleteAria',
      'settingsPanels.card.untitled',
      'settingsPanels.menu.account',
      'settingsPanels.menu.account.description',
      'settingsPanels.menu.account.label',
      'settingsPanels.menu.git',
      'settingsPanels.menu.git.description',
      'settingsPanels.menu.git.label',
      'settingsPanels.nested.deep.drop',
      'settingsPanels.nested.deep.keep',
      'settingsPanels.nested.onlyOne.gone',
      'settingsPanels.other',
      'settingsPanels.wrapped.double',
      'settingsPanels.wrapped.single',
    ])
  })

  it('sees inside a group written on one line', () => {
    const index = buildKeyIndex(LOCALE, NS)
    expect(index['settingsPanels.menu.account.label']).toBeDefined()
    expect(index['settingsPanels.menu.git.description']).toBeDefined()
  })

  it('refuses to delete a key that lives inside a one-line group', () => {
    // deleting it on its own is impossible; deleting the line would take its
    // neighbours with it, so the safe answer is to leave it alone
    const out = pruneKeys(LOCALE, ['settingsPanels.menu.account.label'], NS)
    expect(out).toBe(LOCALE)
  })

  it('a value containing braces does not shift the nesting', () => {
    const index = buildKeyIndex(LOCALE, NS)
    expect(index['settingsPanels.braces']).toBeDefined()
    // if the brace in the value had been counted, `other` would have moved
    expect(index['settingsPanels.other']).toBeDefined()
  })
})

describe('pruneKeys', () => {
  it('removes exactly the named keys and nothing else', () => {
    const out = pruneKeys(LOCALE, ['settingsPanels.card.untitled'], NS)
    expect(out).not.toContain('Untitled Session')
    expect(out).toContain("deleteAria: 'Delete session'")
    expect(out).toContain("other: 'kept too'")
  })

  it('drops a group that emptied out', () => {
    const out = pruneKeys(LOCALE, ['settingsPanels.nested.onlyOne.gone'], NS)
    expect(out).not.toContain('onlyOne')
    expect(out).not.toContain('alone in here')
    expect(out).toContain("keep: 'kept'")
  })

  it('keeps a group that still has something in it', () => {
    const out = pruneKeys(LOCALE, ['settingsPanels.nested.deep.drop'], NS)
    expect(out).toContain('deep: {')
    expect(out).toContain("keep: 'kept'")
  })

  it('ignores a key belonging to another namespace instead of guessing', () => {
    // this is the failure the first version had: it looked for the tail of
    // the key and found one anyway
    expect(pruneKeys(LOCALE, ['misc.card.untitled'], NS)).toBe(LOCALE)
  })

  it('leaves the file byte-identical when asked to remove nothing', () => {
    expect(pruneKeys(LOCALE, [], NS)).toBe(LOCALE)
  })

  it('takes the whole value with the key when the value is on the next line', () => {
    const out = pruneKeys(LOCALE, ['settingsPanels.wrapped.double'], NS)
    // the orphan string is the failure mode: a removed key must not leave
    // its value behind as a bare expression
    expect(out).not.toContain('another long sentence')
    expect(out).toContain('single:')
    expect(out).toContain('a long sentence')
    // and what comes out still has to be the same object minus that key
    const after = objectOf(out).wrapped as Record<string, unknown>
    expect(Object.keys(after)).toEqual(['single'])
  })

  it('produces the same object minus exactly those keys', () => {
    const out = pruneKeys(
      LOCALE,
      ['settingsPanels.nested.deep.drop', 'settingsPanels.nested.onlyOne.gone'],
      NS,
    )
    const before = objectOf(LOCALE)
    const after = objectOf(out)
    expect(Object.keys(after)).toEqual(Object.keys(before))
    const nested = after.nested as Record<string, Record<string, unknown>>
    expect(Object.keys(nested.deep)).toEqual(['keep'])
    expect(nested.onlyOne).toBeUndefined()
  })
})