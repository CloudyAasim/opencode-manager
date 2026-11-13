import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenCodeClient } from './opencode'

describe('OpenCodeClient', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('responds to permission requests via the request-scoped reply endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))

    await new OpenCodeClient('/api/opencode', '/repo').respondToPermission('per_1', 'reject')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/opencode/permission/per_1/reply?directory=%2Frepo',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ reply: 'reject' }),
      }),
    )
  })

})
