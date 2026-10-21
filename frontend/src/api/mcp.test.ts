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
   * proxy refuses it for anybody who is not the administrator.
   */
  it('finishes an OAuth flow in the working directory it belongs to', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'connected' }), { status: 200 }))

    await mcpApi.completeAuth('alpha', 'the-code', '/repo')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/opencode/mcp/alpha/auth/callback?directory=%2Frepo',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('leaves the directory out when there is none to name', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'connected' }), { status: 200 }))

    await mcpApi.completeAuth('alpha', 'the-code')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/opencode/mcp/alpha/auth/callback',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
