import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mcpApi } from './mcp'

describe('mcpApi', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * Finishing an OAuth flow is a change, and a change lands in a working
   * directory. Without the directory it lands in the directory the server
   * itself was started in, which belongs to nobody in particular - so the
   * layer refuses it for anybody who is not the administrator.
   */
  it('finishes an OAuth flow in the working directory it belongs to', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 200 }))

    await mcpApi.completeAuth('alpha', 'the-code', '/repo')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/bff/mcp/alpha/auth/callback?directories=%2Frepo',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('leaves the directory out when there is none to name', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 200 }))

    await mcpApi.completeAuth('alpha', 'the-code')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/bff/mcp/alpha/auth/callback',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  /**
   * The secret that belongs to an OAuth client is read out of the
   * configuration the person wrote it into, by the server that holds it. A
   * client that draws a list of servers has no reason to carry one - and a
   * client that carried one would be a place the secret could leak from.
   */
  it('does not carry a secret when it asks for an authorization', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ authorizationUrl: 'https://example.com', flowId: 'f' }), {
        status: 200,
      }),
    )

    await mcpApi.startAuth('alpha', 'https://mcp.example.com', 'read things', 'the-client', '/repo')

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? '{}')
    expect(body).not.toHaveProperty('clientSecret')
    expect(body.serverName).toBe('alpha')
    expect(body.directory).toBe('/repo')
  })
})
