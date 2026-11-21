import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_PLACEHOLDER,
  credentialSites,
  isCredentialName,
  maskCredentials,
  maskCredentialsInText,
  restoreCredentials,
  restoreCredentialsInText,
} from './opencode-config-credentials'

describe('哪些名字是凭据', () => {
  it('名字说出来了，就是凭据', () => {
    expect(isCredentialName('apiKey')).toBe(true)
    expect(isCredentialName('clientSecret')).toBe(true)
    expect(isCredentialName('accessToken')).toBe(true)
    expect(isCredentialName('password')).toBe(true)
    expect(isCredentialName('passphrase')).toBe(true)
    expect(isCredentialName('Authorization')).toBe(true)
  })

  it('名字没说，就不是凭据', () => {
    expect(isCredentialName('baseURL')).toBe(false)
    expect(isCredentialName('npm')).toBe(false)
    expect(isCredentialName('name')).toBe(false)
  })

  it('碰巧结尾像的，宁可多藏一个', () => {
    // 藏错一个的代价是某个无害的值显示成 ***；漏藏一个的代价是密钥进了
    // 浏览器。后者贵得多，所以规则往藏的那边倒。
    expect(isCredentialName('monkey')).toBe(true)
    // 而开头像的不算：规则说的是「结尾」。
    expect(isCredentialName('tokenizer')).toBe(false)
  })
})

describe('凭据在文档里的哪儿', () => {
  it('只有字符串才是凭据', () => {
    const sites = credentialSites({
      provider: {
        acme: { options: { apiKey: 'sk-live-1', retries: 3, headers: { key: { a: 1 } } } },
      },
    })

    expect(sites.map((site) => site.path)).toEqual([
      ['provider', 'acme', 'options', 'apiKey'],
    ])
  })

  it('数组里的也算', () => {
    const sites = credentialSites({ servers: [{ token: 't-1' }, { token: 't-2' }] })

    expect(sites.map((site) => site.path)).toEqual([
      ['servers', 0, 'token'],
      ['servers', 1, 'token'],
    ])
  })
})

describe('读的时候，凭据换成占位符', () => {
  it('值换掉，路径留着', () => {
    const masked = maskCredentials({
      provider: { acme: { options: { apiKey: 'sk-live-1', baseURL: 'https://x' } } },
    })

    expect(masked).toEqual({
      provider: { acme: { options: { apiKey: CREDENTIAL_PLACEHOLDER, baseURL: 'https://x' } } },
    })
  })

  it('文本里就地换，注释和排版都还在', () => {
    const text = [
      '{',
      '  // the key of the house',
      '  "provider": { "acme": { "options": { "apiKey": "sk-live-1" } } }',
      '}',
    ].join('\n')

    const masked = maskCredentialsInText(text, {
      provider: { acme: { options: { apiKey: 'sk-live-1' } } },
    })

    expect(masked).toContain('// the key of the house')
    expect(masked).toContain(`"apiKey": "${CREDENTIAL_PLACEHOLDER}"`)
    expect(masked).not.toContain('sk-live-1')
  })

  it('文档里没有的那个路径，不会被造出来', () => {
    // `modify` 是编辑器不是读者：它会把没有的路径写出来。遮 credential
    // 的时候绝不能顺手造一个 provider 出来。
    const text = '{ "provider": {} }'

    const masked = maskCredentialsInText(text, {
      provider: { acme: { options: { apiKey: 'sk-live-1' } } },
    })

    expect(masked).toBe(text)
  })
})

describe('写的时候，服务端用自己的值', () => {
  const own = {
    provider: { acme: { options: { apiKey: 'sk-real', baseURL: 'https://x' } } },
  }

  it('客户端写的另一个值不算数', () => {
    const { value } = restoreCredentials(
      { provider: { acme: { options: { apiKey: 'sk-from-the-browser' } } } },
      own,
    )

    expect(value).toEqual({
      provider: { acme: { options: { apiKey: 'sk-real' } } },
    })
  })

  it('provider 还在，它的键就还在——客户端删不掉', () => {
    const { value } = restoreCredentials(
      { provider: { acme: { options: { baseURL: 'https://x' } } } },
      own,
    )

    expect(value).toEqual({
      provider: { acme: { options: { apiKey: 'sk-real', baseURL: 'https://x' } } },
    })
  })

  it('provider 没了，键跟着走', () => {
    const { value } = restoreCredentials({ provider: {} }, own)

    expect(value).toEqual({ provider: {} })
  })

  it('文本形态也一样：键还在就放回去，provider 没了就不放', () => {
    const text = '{ "provider": { "acme": { "options": { "apiKey": "***" } } } }'

    const { value } = restoreCredentialsInText(text, own)

    expect(value).toContain('"apiKey": "sk-real"')
    expect(value).not.toContain('***')
  })

  it('provider 从文本里没了，键不会被写回去', () => {
    const text = '{ "provider": {} }'

    const { value } = restoreCredentialsInText(text, own)

    expect(value).toBe(text)
  })

  it('provider 在、键被客户端删了，键回来', () => {
    const text = '{ "provider": { "acme": { "options": { "baseURL": "https://x" } } } }'

    const { value } = restoreCredentialsInText(text, own)

    expect(value).toContain('"apiKey": "sk-real"')
  })
})

describe('改不成的，要说出来', () => {
  const own = {
    provider: { acme: { options: { apiKey: 'sk-real', baseURL: 'https://x' } } },
  }

  it('客户端写了另一个键，那一处被点名', () => {
    const { value, overridden } = restoreCredentials(
      { provider: { acme: { options: { apiKey: 'sk-from-the-browser' } } } },
      own,
    )

    expect(overridden).toEqual(['provider.acme.options.apiKey'])
    // 说了不算数的东西，最后落盘的还是服务端那份。
    expect(value).toMatchObject({ provider: { acme: { options: { apiKey: 'sk-real' } } } })
  })

  it('客户端把那一行删了，也算改不成，也被点名', () => {
    // 「我以为我把这个键删了」是最贵的一种以为：人以为凭据已经撤了，
    // 其实它还在盘上。所以删掉也跟写别的一样，是一次没有发生的改动。
    const { value, overridden } = restoreCredentials(
      { provider: { acme: { options: { baseURL: 'https://x' } } } },
      own,
    )

    expect(overridden).toEqual(['provider.acme.options.apiKey'])
    expect(value).toMatchObject({ provider: { acme: { options: { apiKey: 'sk-real' } } } })
  })

  it('占位符原样送回来，不算改——没什么可说的', () => {
    const { overridden } = restoreCredentials(
      { provider: { acme: { options: { apiKey: CREDENTIAL_PLACEHOLDER } } } },
      own,
    )

    expect(overridden).toEqual([])
  })

  it('provider 都没了，键跟着走，没什么可说的', () => {
    const { value, overridden } = restoreCredentials({ provider: {} }, own)

    expect(overridden).toEqual([])
    expect(value).toEqual({ provider: {} })
  })

  it('文本形态：写了别的键，那一处被点名', () => {
    const text = '{ "provider": { "acme": { "options": { "apiKey": "sk-from-the-browser" } } } }'

    const { overridden } = restoreCredentialsInText(text, own)

    expect(overridden).toEqual(['provider.acme.options.apiKey'])
  })

  it('文本形态：占位符原样送回来，不算改', () => {
    const text = '{ "provider": { "acme": { "options": { "apiKey": "***" } } } }'

    const { overridden } = restoreCredentialsInText(text, own)

    expect(overridden).toEqual([])
  })
})
