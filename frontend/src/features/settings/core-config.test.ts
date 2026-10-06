import { describe, expect, it } from 'vitest'
import {
  UNSET,
  applyPatch,
  asStringList,
  parseLineList,
  readCompaction,
  readPermission,
  sectionPatch,
  stringOrUnset,
  withCompaction,
  withPermissionDecisions,
} from './core-config'

describe('readPermission', () => {
  it('keeps only the tools it knows how to set', () => {
    const decisions = readPermission({ edit: 'allow', bash: 'deny', somethingElse: 'allow' })

    expect(decisions).toEqual({ edit: 'allow', bash: 'deny' })
  })

  it('ignores a value that is not one of the three decisions', () => {
    // A typo in the file must not become a `<Select>` with no matching item,
    // which renders as an empty control that saves nothing back.
    expect(readPermission({ edit: 'maybe' })).toEqual({})
  })
})

describe('withPermissionDecisions', () => {
  it('leaves a tool it does not know about exactly where it was', () => {
    const merged = withPermissionDecisions(
      { edit: 'allow', somethingNewerThanThisPage: 'deny' },
      { edit: 'deny' },
    )

    // The whole point: a settings page that rewrites a document it does not
    // fully understand deletes whatever it did not recognise.
    expect(merged).toEqual({ edit: 'deny', somethingNewerThanThisPage: 'deny' })
  })

  it('removes a tool that was cleared instead of writing null', () => {
    const merged = withPermissionDecisions({ edit: 'allow', bash: 'ask' }, { edit: 'allow' })

    expect(merged).toEqual({ edit: 'allow' })
    expect('bash' in merged).toBe(false)
  })

  it('turns a document with no permission at all into one that still has none', () => {
    expect(withPermissionDecisions(undefined, {})).toEqual({})
  })
})

describe('withCompaction', () => {
  it('keeps a compaction key it does not know about', () => {
    const merged = withCompaction({ auto: false, preserve_recent_tokens: 20000 }, { auto: true })

    expect(merged).toEqual({ auto: true, preserve_recent_tokens: 20000 })
  })

  it('removes the flag that was cleared', () => {
    const merged = withCompaction({ auto: true, prune: false }, { auto: true })

    expect(merged).toEqual({ auto: true })
  })
})

describe('readCompaction', () => {
  it('reports an absent flag as absent rather than as false', () => {
    // `false` is a decision. Reading a missing key as false would make the page
    // offer to save a default that was never set.
    expect(readCompaction({})).toEqual({ auto: undefined, prune: undefined })
    expect(readCompaction({ prune: false })).toEqual({ auto: undefined, prune: false })
  })
})

describe('applyPatch', () => {
  it('removes the key whose new value is undefined', () => {
    const next = applyPatch({ theme: 'dark', model: 'a/b' }, { model: undefined })

    expect(next).toEqual({ theme: 'dark' })
    expect('model' in next).toBe(false)
  })

  it('does not touch a key the patch never mentions', () => {
    const next = applyPatch({ theme: 'dark', model: 'a/b', provider: { x: {} } }, { model: 'c/d' })

    expect(next).toEqual({ theme: 'dark', model: 'c/d', provider: { x: {} } })
  })

  it('does not mutate the document it was given', () => {
    const content = { model: 'a/b' }
    applyPatch(content, { model: 'c/d' })

    expect(content.model).toBe('a/b')
  })
})

describe('sectionPatch', () => {
  it('keeps a section that still has something in it', () => {
    expect(sectionPatch('permission', { edit: 'allow' })).toEqual({ permission: { edit: 'allow' } })
  })

  it('drops a section that ended up empty', () => {
    // `compaction: {}` is not the same as no compaction: it is a section
    // somebody asked for and got nothing for.
    expect(sectionPatch('compaction', {})).toEqual({ compaction: undefined })
  })
})

describe('parseLineList', () => {
  it('drops blank lines and trims the rest', () => {
    expect(parseLineList('  openai \n\n anthropic\n   \n')).toEqual(['openai', 'anthropic'])
  })

  it('reads a non-array as an empty list', () => {
    expect(asStringList('openai')).toEqual([])
  })
})

describe('stringOrUnset', () => {
  it('treats a whitespace-only field as clearing the key', () => {
    expect(stringOrUnset('   ')).toBeUndefined()
    expect(stringOrUnset(' openai ')).toBe('openai')
  })
})

describe('the unset sentinel', () => {
  it('is distinct from every real decision', () => {
    // A `<Select>` can only pick one of its items. If "absent" were spelled the
    // same way as a decision, clearing a tool would be unexpressible.
    expect(UNSET).not.toBe('allow')
    expect(UNSET).not.toBe('ask')
    expect(UNSET).not.toBe('deny')
  })
})