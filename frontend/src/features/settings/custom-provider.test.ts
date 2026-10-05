import { describe, it, expect } from 'vitest'
import {
  buildCustomProviderEntry,
  conflictingProviderId,
  customProviderFormSchema,
  emptyCustomProviderDraft,
  withCustomProvider,
  type CustomProviderDraft,
} from './custom-provider'

function draft(overrides: Partial<CustomProviderDraft> = {}): CustomProviderDraft {
  return {
    providerId: 'my-provider',
    name: 'My Provider',
    kind: 'api',
    baseUrl: 'https://example.com/v1',
    models: [{ id: 'my-model', name: 'My Model' }],
    ...overrides,
  }
}

function issuePaths(values: unknown): string[] {
  const result = customProviderFormSchema.safeParse(values)
  if (result.success) return []
  return result.error.issues.map((issue) => issue.path.join('.'))
}

describe('the provider block that gets written', () => {
  it('declares an OpenAI-compatible endpoint', () => {
    const entry = buildCustomProviderEntry(draft())

    expect(entry).toEqual({
      name: 'My Provider',
      api: 'https://example.com/v1',
      // Both keys, because OpenCode reads one or the other depending on the
      // sdk. Dropping one here would make the provider work in the editor and
      // fail at call time, or the other way round.
      options: { baseURL: 'https://example.com/v1' },
      models: { 'my-model': { name: 'My Model' } },
    })
  })

  it('declares an npm sdk instead, and no endpoint', () => {
    const entry = buildCustomProviderEntry(
      draft({ kind: 'npm', npm: '@ai-sdk/openai-compatible', baseUrl: undefined }),
    )

    expect(entry.npm).toBe('@ai-sdk/openai-compatible')
    expect(entry.api).toBeUndefined()
    expect(entry.options).toBeUndefined()
    expect(entry.models).toEqual({ 'my-model': { name: 'My Model' } })
  })

  it('never writes an API key', () => {
    // The whole point of keeping `apiKey` out of the draft type. The global
    // config outranks a user's, so a key here would silently beat the one they
    // type under Settings > Providers.
    for (const kind of ['api', 'npm'] as const) {
      const entry = buildCustomProviderEntry(draft({ kind, npm: '@ai-sdk/openai-compatible' }))
      expect(JSON.stringify(entry)).not.toContain('apiKey')
    }
  })

  it('falls back to the id for the display name, and to the model id for a nameless model', () => {
    const entry = buildCustomProviderEntry(
      draft({ name: undefined, models: [{ id: 'bare-model' }] }),
    )

    expect(entry.name).toBe('my-provider')
    expect(entry.models).toEqual({ 'bare-model': { name: 'bare-model' } })
  })

  it('keeps several models', () => {
    const entry = buildCustomProviderEntry(
      draft({ models: [{ id: 'a' }, { id: 'b', name: 'B' }] }),
    )

    expect(Object.keys(entry.models)).toEqual(['a', 'b'])
  })
})

describe('merging it into a config', () => {
  it('adds one key and leaves everything else exactly as it was', () => {
    const config = {
      theme: 'dark',
      provider: { openai: { name: 'OpenAI', models: { 'gpt-x': {} } } },
      agent: { reviewer: { prompt: 'review' } },
    }

    const next = withCustomProvider(config, draft())

    expect(Object.keys(next).sort()).toEqual(['agent', 'provider', 'theme'])
    expect(next.theme).toBe('dark')
    expect(next.agent).toBe(config.agent)
    // The sibling provider is untouched, models included.
    expect(next.provider).toMatchObject({
      openai: { name: 'OpenAI', models: { 'gpt-x': {} } },
      'my-provider': { name: 'My Provider' },
    })
    // ...and the input was not modified in place.
    expect(config.provider).not.toHaveProperty('my-provider')
  })

  it('works on a config that has no provider section at all', () => {
    const next = withCustomProvider({ theme: 'dark' }, draft())

    expect(Object.keys(next.provider as object)).toEqual(['my-provider'])
    expect(next.theme).toBe('dark')
  })
})

describe('refusing to replace a provider that already exists', () => {
  it('names the id when it is taken', () => {
    expect(conflictingProviderId({ providerId: 'openai' }, ['openai', 'anthropic'])).toBe('openai')
  })

  it('is quiet for an id that is free', () => {
    expect(conflictingProviderId({ providerId: 'brand-new' }, ['openai'])).toBeNull()
  })

  it('treats a blank id as not taken, so the required-field error is what shows', () => {
    // Otherwise the dialog would say "that already exists" about an id nobody
    // typed, and the real problem would stay hidden.
    expect(conflictingProviderId({ providerId: '   ' }, ['openai'])).toBeNull()
  })
})

describe('what the form refuses', () => {
  it('accepts a complete draft', () => {
    const result = customProviderFormSchema.safeParse({
      providerId: 'my-provider',
      name: '',
      kind: 'api',
      baseUrl: 'https://example.com/v1',
      npm: '',
      models: [{ id: 'my-model', name: '' }],
    })

    expect(result.success).toBe(true)
  })

  it('requires a provider id, and says so on the id field', () => {
    expect(issuePaths({ kind: 'api', baseUrl: 'https://x/v1', models: [{ id: 'm' }] })).toContain('providerId')
  })

  it('refuses an id with characters that would break the model name', () => {
    expect(issuePaths({ providerId: 'My Provider!', kind: 'api', baseUrl: 'https://x/v1', models: [{ id: 'm' }] }))
      .toContain('providerId')
  })

  it('refuses an empty id without flagging the other fields, so one error is one mistake', () => {
    const paths = issuePaths({ providerId: '', kind: 'npm', npm: '', models: [{ id: 'm' }] })

    expect(paths).toContain('providerId')
    expect(paths).toContain('npm')
  })

  it('requires the endpoint for an api provider and the package for an npm one', () => {
    expect(issuePaths({ providerId: 'p', kind: 'api', baseUrl: '', models: [{ id: 'm' }] })).toContain('baseUrl')
    expect(issuePaths({ providerId: 'p', kind: 'npm', npm: '', models: [{ id: 'm' }] })).toContain('npm')
  })

  it('requires at least one model', () => {
    // The config editor hides a provider with no models, so declaring one on
    // its own would produce an entry that looks like it did nothing.
    expect(issuePaths({ providerId: 'p', kind: 'api', baseUrl: 'https://x/v1', models: [] })).toContain('models')
  })

  it('refuses a duplicate model id, because the record it becomes would keep only the last', () => {
    const paths = issuePaths({
      providerId: 'p',
      kind: 'api',
      baseUrl: 'https://x/v1',
      models: [{ id: 'same' }, { id: 'same' }],
    })

    expect(paths).toContain('models.1.id')
  })

  it('refuses an empty or malformed model id', () => {
    expect(issuePaths({ providerId: 'p', kind: 'api', baseUrl: 'https://x/v1', models: [{ id: '' }] }))
      .toContain('models.0.id')
    expect(issuePaths({ providerId: 'p', kind: 'api', baseUrl: 'https://x/v1', models: [{ id: 'bad id!' }] }))
      .toContain('models.0.id')
  })

  it('starts from a form that is empty rather than pre-filled', () => {
    const empty = emptyCustomProviderDraft()

    expect(empty.providerId).toBe('')
    expect(empty.models).toHaveLength(1)
    expect(empty.models[0].id).toBe('')
  })
})
