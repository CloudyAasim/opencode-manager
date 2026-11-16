import { describe, expect, it } from 'vitest'
import {
  toProviderAuthFailure,
  toProviderAuthMethods,
  toProviderOAuthAuthorization,
} from './oauth'

describe('agent 的话，翻译成这一层的话', () => {
  it('agent 给自己的错起名字，这一层给同一件事起自己的名字', () => {
    const names: Record<string, string> = {
      BadRequest: 'bad_request',
      ProviderAuthOauthMissing: 'authorization_missing',
      ProviderAuthOauthCodeMissing: 'code_missing',
      ProviderAuthOauthCallbackFailed: 'callback_failed',
      ProviderAuthValidationFailed: 'validation_failed',
      InvalidRequestError: 'invalid_request',
    }

    for (const [name, reason] of Object.entries(names)) {
      const body = name === 'InvalidRequestError'
        ? JSON.stringify({ _tag: 'InvalidRequestError', message: 'nope' })
        : JSON.stringify({ name, data: { message: 'the provider said so' } })

      expect(toProviderAuthFailure(body).reason).toBe(reason)
    }
  })

  it('agent 说了什么，也带过来', () => {
    const failure = toProviderAuthFailure(
      JSON.stringify({
        name: 'ProviderAuthValidationFailed',
        data: { message: 'must start with sk-', field: 'apiKey' },
      }),
    )

    expect(failure.reason).toBe('validation_failed')
    expect(failure.detail).toBe('must start with sk- — field: apiKey')
  })

  it('看不懂的失败，也还是失败', () => {
    expect(toProviderAuthFailure('not json at all').reason).toBe('bad_request')
    expect(toProviderAuthFailure('{"something":"else"}').reason).toBe('bad_request')
    expect(toProviderAuthFailure('{"something":"else"}').detail).toBeNull()
  })

  it('登录的方式：agent 的两段式问法，翻成这一层的一段式', () => {
    const methods = toProviderAuthMethods({
      anthropic: [
        {
          type: 'oauth',
          label: 'Claude Pro / Max',
          prompts: [
            { type: 'text', key: 'email', message: 'Your email', placeholder: 'you@example.com' },
            {
              type: 'select',
              key: 'plan',
              message: 'Your plan',
              options: [{ label: 'Pro', value: 'pro', hint: 'The paid one' }],
              when: { key: 'plan', op: 'eq', value: 'pro' },
            },
          ],
        },
      ],
    })

    expect(methods).toEqual({
      anthropic: [
        {
          type: 'oauth',
          label: 'Claude Pro / Max',
          prompts: [
            {
              type: 'text',
              key: 'email',
              message: 'Your email',
              placeholder: 'you@example.com',
              options: null,
              when: null,
            },
            {
              type: 'select',
              key: 'plan',
              message: 'Your plan',
              placeholder: null,
              options: [{ label: 'Pro', value: 'pro', hint: 'The paid one' }],
              when: { key: 'plan', value: 'pro' },
            },
          ],
        },
      ],
    })
  })

  it('条件上的算子，这一层只带它是什么意思', () => {
    // The agent says "the answer equals the value" with an operator of its
    // own. An operator this layer does not know is not a condition it can
    // carry, and a question it cannot condition is a question it cannot ask.
    const unknown = toProviderAuthMethods({
      anthropic: [
        {
          type: 'oauth',
          label: 'OAuth',
          prompts: [
            { type: 'text', key: 'email', message: 'Your email' },
            {
              type: 'text',
              key: 'enterpriseUrl',
              message: 'Your enterprise URL',
              when: { key: 'plan', op: 'contains', value: 'enterprise' },
            },
          ],
        },
      ],
    })

    expect(unknown.anthropic?.[0]?.prompts).toHaveLength(1)
    expect(unknown.anthropic?.[0]?.prompts?.[0]?.key).toBe('email')
  })

  it('读不懂的方式就丢掉，而不是编一个', () => {
    const methods = toProviderAuthMethods({
      anthropic: [
        { type: 'something-new', label: 'A way we do not know' },
        { type: 'oauth' },
        { type: 'api', label: 'API key' },
      ],
      broken: 'not a list',
    })

    expect(methods).toEqual({ anthropic: [{ type: 'api', label: 'API key', prompts: null }] })
  })

  it('授权：说得出地址和方法才是授权', () => {
    expect(
      toProviderOAuthAuthorization({
        url: 'https://example.invalid/authorize',
        method: 'code',
        instructions: 'Paste the code back.',
      }),
    ).toEqual({
      url: 'https://example.invalid/authorize',
      method: 'code',
      instructions: 'Paste the code back.',
    })

    expect(toProviderOAuthAuthorization({ url: 'https://example.invalid' })).toBeNull()
    expect(toProviderOAuthAuthorization({ url: 'x', method: 'telepathy', instructions: 'y' })).toBeNull()
    expect(toProviderOAuthAuthorization('not an object')).toBeNull()
  })
})
