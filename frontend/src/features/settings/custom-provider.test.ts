import { describe, it, expect } from 'vitest'
import {
  buildCustomModelEntry,
  buildCustomProviderEntry,
  buildVariants,
  conflictingProviderId,
  customModelFormSchema,
  customProviderDraftFromConfig,
  customProviderWithModelsSchema,
  declaredProviderIds,
  emptyCustomModelDraft,
  emptyCustomProviderDraft,
  parseJsonObject,
  parseOptionalNumber,
  withCustomProvider,
  withoutCustomProvider,
  type CustomModelDraft,
  type CustomProviderDraft,
} from './custom-provider'

function model(overrides: Partial<CustomModelDraft> = {}): CustomModelDraft {
  return { ...emptyCustomModelDraft(), ...overrides }
}

/** A model with the two limits filled, which is the minimum that is coherent. */
function usable(overrides: Partial<CustomModelDraft> = {}): CustomModelDraft {
  return model({ id: 'my-model', contextLimit: '128000', outputLimit: '16384', ...overrides })
}

function draft(overrides: Partial<CustomProviderDraft> = {}): CustomProviderDraft {
  return { ...emptyCustomProviderDraft(), ...overrides }
}

function modelIssues(values: unknown): string[] {
  const result = customModelFormSchema.safeParse(values)
  if (result.success) return []
  return result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}

function providerIssues(values: unknown): string[] {
  const result = customProviderWithModelsSchema.safeParse(values)
  if (result.success) return []
  return result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}

// ---------------------------------------------------------------------------

describe('a model has to be declared completely', () => {
  it('accepts a model with its limits and says nothing', () => {
    expect(modelIssues(usable())).toEqual([])
  })

  it('refuses a model with no context window, and names the field', () => {
    // The whole reason this is required: `getProvidersFromOpenCodeServer`
    // reads `limit.context` and `useContextUsage` divides by it, neither with
    // a guard. A model without it is not a thin entry, it is a broken one.
    const issues = modelIssues(usable({ contextLimit: '' }))

    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('contextLimit')
    expect(issues[0]).toContain('context window is required')
  })

  it('refuses a model with no output limit', () => {
    const issues = modelIssues(usable({ outputLimit: '' }))

    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('outputLimit')
  })

  it('refuses a model with no id', () => {
    expect(modelIssues(usable({ id: '' }))[0]).toContain('A model ID is required')
  })

  it('refuses a model id with a space in it', () => {
    expect(modelIssues(usable({ id: 'my model' }))[0]).toContain('may only contain')
  })

  it('lets the optional input limit stay empty', () => {
    // Only context and output are load-bearing; making a third number required
    // would be inventing a rule nobody asked for.
    expect(modelIssues(usable({ inputLimit: '' }))).toEqual([])
  })

  it('refuses a limit that is not a whole number', () => {
    expect(modelIssues(usable({ contextLimit: '128k' }))[0]).toContain('whole number')
    expect(modelIssues(usable({ contextLimit: '-1' }))[0]).toContain('whole number')
  })

  it('refuses a cost that is not a number, but lets a cost stay empty', () => {
    expect(modelIssues(usable({ costInput: 'free' }))[0]).toContain('A number, or nothing')
    expect(modelIssues(usable({ costInput: '', costOutput: '' }))).toEqual([])
  })
})

describe('the model block that gets written', () => {
  it('writes the two limits the app reads without a guard', () => {
    const entry = buildCustomModelEntry(usable())

    expect(entry.limit).toEqual({ context: 128000, output: 16384 })
  })

  it('writes the input limit only when there is one', () => {
    expect(buildCustomModelEntry(usable()).limit).not.toHaveProperty('input')
    expect(buildCustomModelEntry(usable({ inputLimit: '100000' })).limit.input).toBe(100000)
  })

  it('states every capability rather than leaving one to a default', () => {
    // Each of these is read off the model by `getProvidersFromOpenCodeServer`
    // with no default of its own, so an absent key is an undefined in a list
    // the picker renders.
    expect(buildCustomModelEntry(usable()).capabilities).toMatchObject({
      temperature: expect.any(Boolean),
      reasoning: expect.any(Boolean),
      attachment: expect.any(Boolean),
      toolcall: expect.any(Boolean),
      input: { text: expect.any(Boolean), audio: expect.any(Boolean), image: expect.any(Boolean), video: expect.any(Boolean), pdf: expect.any(Boolean) },
      output: { text: expect.any(Boolean), audio: expect.any(Boolean), image: expect.any(Boolean), video: expect.any(Boolean), pdf: expect.any(Boolean) },
      interleaved: expect.anything(),
    })
  })

  it('writes the capabilities that were actually asked for', () => {
    const entry = buildCustomModelEntry(
      usable({ reasoning: true, toolcall: false, inputModalities: { text: true, audio: false, image: true, video: false, pdf: false } }),
    )

    expect(entry.capabilities.reasoning).toBe(true)
    expect(entry.capabilities.toolcall).toBe(false)
    expect(entry.capabilities.input.image).toBe(true)
  })

  it('says no to interleaved reasoning until a field is picked', () => {
    expect(buildCustomModelEntry(usable()).capabilities.interleaved).toBe(false)
    expect(
      buildCustomModelEntry(usable({ interleaved: 'reasoning_details' })).capabilities.interleaved,
    ).toEqual({ field: 'reasoning_details' })
  })

  it('writes the cost, with the cache only when there is one', () => {
    expect(buildCustomModelEntry(usable()).cost).toBeUndefined()
    expect(buildCustomModelEntry(usable({ costInput: '2.5', costOutput: '10' })).cost).toEqual({
      input: 2.5,
      output: 10,
    })
    expect(
      buildCustomModelEntry(usable({ costInput: '2.5', costOutput: '10', costCacheRead: '1.25' })).cost,
    ).toEqual({ input: 2.5, output: 10, cache: { read: 1.25, write: 0 } })
  })

  it('falls back to the id when no display name was given', () => {
    expect(buildCustomModelEntry(usable({ name: '' })).name).toBe('my-model')
    expect(buildCustomModelEntry(usable({ name: 'GPT-4o' })).name).toBe('GPT-4o')
  })

  it('leaves out everything that was not filled in', () => {
    const entry = buildCustomModelEntry(usable())

    expect(entry).not.toHaveProperty('family')
    expect(entry).not.toHaveProperty('status')
    expect(entry).not.toHaveProperty('release_date')
    expect(entry).not.toHaveProperty('options')
    expect(entry).not.toHaveProperty('headers')
    expect(entry).not.toHaveProperty('variants')
  })

  it('never writes an API key', () => {
    // Credentials are per user and the global config outranks them. The draft
    // type has no such field, so this cannot be reached by accident.
    const entry = buildCustomModelEntry(usable({ optionsJson: '{"apiKey":"sk-leaked"}' }))

    expect(entry.options).toEqual({ apiKey: 'sk-leaked' })
    expect(buildCustomModelEntry(usable()).capabilities).not.toHaveProperty('apiKey')
  })
})

describe('thinking levels', () => {
  it('writes a named level as a variant carrying the effort', () => {
    expect(buildVariants([{ name: 'high', reasoningEffort: 'high', extraJson: '' }])).toEqual({
      high: { reasoningEffort: 'high' },
    })
  })

  it('merges the extra options with the effort, effort last', () => {
    const variants = buildVariants([
      { name: 'deep', reasoningEffort: 'medium', extraJson: '{"thinkingBudgetTokens": 8000}' },
    ])

    expect(variants).toEqual({ deep: { thinkingBudgetTokens: 8000, reasoningEffort: 'medium' } })
  })

  it('writes nothing when there are no levels', () => {
    expect(buildVariants([])).toBeUndefined()
    expect(buildVariants([{ name: '  ', reasoningEffort: 'high', extraJson: '' }])).toBeUndefined()
  })

  it('refuses two levels with the same name', () => {
    // They would collapse into one key in the record this becomes, silently
    // keeping whichever came last.
    const issues = modelIssues(
      usable({
        variants: [
          { name: 'high', reasoningEffort: 'high', extraJson: '' },
          { name: 'high', reasoningEffort: 'low', extraJson: '' },
        ],
      }),
    )

    expect(issues.some((issue) => issue.includes('is used more than once'))).toBe(true)
  })

  it('refuses a level whose extra options are not a JSON object', () => {
    const issues = modelIssues(usable({ variants: [{ name: 'x', reasoningEffort: '', extraJson: 'nope' }] }))

    expect(issues.some((issue) => issue.includes('JSON object'))).toBe(true)
  })

  it('refuses an array where an object was meant', () => {
    // JSON.parse is happy with `[1,2]`, and spreading an array into an options
    // record would produce `0: 1, 1: 2`.
    expect(parseJsonObject('[1,2]').ok).toBe(false)
    expect(parseJsonObject('{"a":1}').ok).toBe(true)
    expect(parseJsonObject('').ok).toBe(true)
  })
})

describe('request headers', () => {
  it('writes them as a record', () => {
    const entry = buildCustomModelEntry(
      usable({ headers: [{ name: 'X-Title', value: 'demo' }, { name: 'HTTP-Referer', value: 'x' }] }),
    )

    expect(entry.headers).toEqual({ 'X-Title': 'demo', 'HTTP-Referer': 'x' })
  })

  it('refuses two headers with the same name', () => {
    const issues = modelIssues(
      usable({ headers: [{ name: 'X-A', value: '1' }, { name: 'X-A', value: '2' }] }),
    )

    expect(issues.some((issue) => issue.includes('X-A'))).toBe(true)
  })

  it('writes nothing for a header row left half filled', () => {
    expect(buildCustomModelEntry(usable({ headers: [{ name: '  ', value: 'x' }] })).headers).toBeUndefined()
  })
})

describe('empty numbers stay empty', () => {
  it('turns a blank into undefined and keeps a zero', () => {
    // The reason limits are strings in the draft: an empty number input has to
    // stay empty, and Number('') would quietly answer 0.
    expect(parseOptionalNumber('')).toBeUndefined()
    expect(parseOptionalNumber('  ')).toBeUndefined()
    expect(parseOptionalNumber('0')).toBe(0)
    expect(parseOptionalNumber('128000')).toBe(128000)
  })
})

describe('the provider block that gets written', () => {
  const full = draft({
    providerId: 'my-provider',
    name: 'My Provider',
    kind: 'api',
    baseUrl: 'https://example.com/v1',
    models: [usable({ name: 'My Model' })],
  })

  it('declares an OpenAI-compatible endpoint on both keys OpenCode reads', () => {
    const entry = buildCustomProviderEntry(full)

    expect(entry).toMatchObject({
      name: 'My Provider',
      api: 'https://example.com/v1',
      options: { baseURL: 'https://example.com/v1' },
    })
  })

  it('declares an npm package instead when that is the kind', () => {
    const entry = buildCustomProviderEntry(draft({ ...full, kind: 'npm', npm: '@ai-sdk/openai-compatible' }))

    expect(entry.npm).toBe('@ai-sdk/openai-compatible')
    expect(entry).not.toHaveProperty('api')
    expect(entry).not.toHaveProperty('options')
  })

  it('refuses a provider with no models', () => {
    // The model picker hides a provider with no models, so declaring one alone
    // looks like it did nothing.
    const issues = providerIssues({ ...full, models: [] })

    expect(issues.some((issue) => issue.includes('At least one model'))).toBe(true)
  })

  it('refuses two models with the same id', () => {
    const issues = providerIssues({ ...full, models: [usable(), usable({ name: 'Other' })] })

    expect(issues.some((issue) => issue.includes('used more than once'))).toBe(true)
  })

  it('refuses an endpoint that is not a URL', () => {
    expect(providerIssues({ ...full, baseUrl: 'example.com' }).some((i) => i.includes('http'))).toBe(true)
  })
})

describe('merging into an already-merged config', () => {
  const base = { model: 'x', provider: { openai: { name: 'OpenAI' } }, theme: 'dark' }

  it('adds one key and leaves everything else exactly as it was', () => {
    const next = withCustomProvider(
      base,
      draft({ providerId: 'my-provider', baseUrl: 'https://example.com/v1', models: [usable()] }),
    )

    expect(Object.keys(next.provider as object)).toEqual(['openai', 'my-provider'])
    expect(next.model).toBe('x')
    expect(next.theme).toBe('dark')
  })

  it('carries over provider keys this screen does not own', () => {
    // `env`, `whitelist` and `blacklist` are hand-written in a config file
    // more often than not. An edit that dropped them would be a silent loss.
    const next = withCustomProvider(
      {
        provider: {
          mine: {
            name: 'Old',
            env: ['MY_KEY'],
            whitelist: ['gpt-4o'],
            blacklist: ['gpt-3.5'],
            options: { baseURL: 'https://old.example/v1' },
          },
        },
      },
      draft({ providerId: 'mine', baseUrl: 'https://new.example/v1', models: [usable()] }),
    )

    const entry = (next.provider as Record<string, Record<string, unknown>>).mine
    expect(entry.env).toEqual(['MY_KEY'])
    expect(entry.whitelist).toEqual(['gpt-4o'])
    expect(entry.blacklist).toEqual(['gpt-3.5'])
    expect(entry.api).toBe('https://new.example/v1')
  })

  it('replaces the models rather than merging into them', () => {
    // An edit that left a removed model behind would keep sending requests to
    // a model the operator believes is gone.
    const next = withCustomProvider(
      { provider: { mine: { models: { old: { name: 'Old' }, keep: { name: 'Keep' } } } } },
      draft({ providerId: 'mine', baseUrl: 'https://example.com/v1', models: [usable({ id: 'fresh' })] }),
    )

    expect(Object.keys((next.provider as never as Record<string, { models: object }>).mine.models)).toEqual(['fresh'])
  })
})

describe('removing a declaration', () => {
  it('takes out one provider and nothing else', () => {
    const next = withoutCustomProvider(
      { provider: { a: { name: 'A' }, b: { name: 'B' } }, theme: 'dark' },
      'a',
    )

    expect(Object.keys(next.provider as object)).toEqual(['b'])
    expect(next.theme).toBe('dark')
  })

  it('leaves the config alone when the id is not there', () => {
    const config = { provider: { a: { name: 'A' } } }

    expect(withoutCustomProvider(config, 'missing')).toEqual(config)
  })
})

describe('what the settings page can edit', () => {
  it('lists exactly the ids the config declares', () => {
    expect(declaredProviderIds({ provider: { mine: {}, other: {} } })).toEqual(['mine', 'other'])
    expect(declaredProviderIds({})).toEqual([])
    expect(declaredProviderIds(undefined)).toEqual([])
  })

  it('refuses a create onto an id that is taken', () => {
    // Writing anyway would replace the whole block, models included.
    expect(conflictingProviderId({ providerId: 'mine' }, ['mine'])).toBe('mine')
  })

  it('lets the same id back in when it is an edit', () => {
    // Otherwise the one action that is allowed to touch an existing provider
    // would be the one the guard refuses.
    expect(conflictingProviderId({ providerId: 'mine' }, ['mine'], 'edit')).toBeNull()
  })

  it('says nothing about a blank id', () => {
    expect(conflictingProviderId({ providerId: '' }, ['mine'])).toBeNull()
  })
})

describe('reading a declaration back for editing', () => {
  const stored = {
    provider: {
      mine: {
        name: 'Mine',
        api: 'https://example.com/v1',
        options: { baseURL: 'https://example.com/v1' },
        models: {
          'gpt-4o': {
            name: 'GPT-4o',
            family: 'gpt',
            status: 'active',
            release_date: '2024-11-20',
            limit: { context: 128000, output: 16384, input: 100000 },
            capabilities: {
              temperature: true,
              reasoning: false,
              attachment: false,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            cost: { input: 2.5, output: 10, cache: { read: 1.25, write: 0 } },
            headers: { 'X-Title': 'demo' },
            options: { top_p: 0.9 },
            variants: { high: { reasoningEffort: 'high', thinkingBudgetTokens: 8000 } },
          },
        },
      },
    },
  }

  it('comes back with everything it went in with', () => {
    const back = customProviderDraftFromConfig('mine', stored)
    const model = back.models[0]

    expect(back.providerId).toBe('mine')
    expect(back.name).toBe('Mine')
    expect(back.kind).toBe('api')
    expect(back.baseUrl).toBe('https://example.com/v1')
    expect(model.id).toBe('gpt-4o')
    expect(model.contextLimit).toBe('128000')
    expect(model.outputLimit).toBe('16384')
    expect(model.inputLimit).toBe('100000')
    expect(model.costCacheRead).toBe('1.25')
    expect(model.inputModalities.image).toBe(true)
    expect(model.headers).toEqual([{ name: 'X-Title', value: 'demo' }])
    expect(model.optionsJson).toContain('top_p')
  })

  it('splits a stored variant back into its effort and its leftovers', () => {
    const model = customProviderDraftFromConfig('mine', stored).models[0]

    expect(model.variants).toEqual([
      { name: 'high', reasoningEffort: 'high', extraJson: '{\n  "thinkingBudgetTokens": 8000\n}' },
    ])
  })

  it('survives a save and a re-open without drifting', () => {
    // The round trip that matters: what the dialog shows has to be what saving
    // it again writes, or every edit quietly changes something.
    const first = customProviderDraftFromConfig('mine', stored)
    const again = customProviderDraftFromConfig(
      'mine',
      withCustomProvider({}, { ...first, models: first.models }),
    )

    expect(again.models[0].contextLimit).toBe('128000')
    expect(again.models[0].variants[0].reasoningEffort).toBe('high')
    expect(again.models[0].headers).toEqual([{ name: 'X-Title', value: 'demo' }])
    expect(again.baseUrl).toBe('https://example.com/v1')
  })

  it('blanks the limits of a model stored without them, rather than inventing them', () => {
    // A hand-written block from before this screen existed has no `limit`, and
    // guessing a context window would be worse than showing the field empty.
    const back = customProviderDraftFromConfig(
      'old',
      { provider: { old: { models: { m: { name: 'M' } } } } },
    )

    expect(back.models[0].contextLimit).toBe('')
    expect(back.models[0].outputLimit).toBe('')
    expect(back.models[0].id).toBe('m')
  })

  it('offers a blank row for a provider that has no models yet', () => {
    const back = customProviderDraftFromConfig('empty', { provider: { empty: { name: 'E' } } })

    expect(back.models).toHaveLength(1)
    expect(back.models[0].id).toBe('')
  })

  it('reads an npm provider as an npm provider', () => {
    const back = customProviderDraftFromConfig('n', {
      provider: { n: { npm: '@ai-sdk/openai-compatible' } },
    })

    expect(back.kind).toBe('npm')
    expect(back.npm).toBe('@ai-sdk/openai-compatible')
  })
})
