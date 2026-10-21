import { describe, it, expect, vi } from 'vitest'
import { readProxyTarget, writeProxyTarget } from './proxy-target'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('客户端代理', () => {
  it('报出它指向哪里', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ target: 'https://code.example.com' }))

    const target = await readProxyTarget(fetchImpl as unknown as typeof fetch)

    expect(target?.target).toBe('https://code.example.com')
    expect(fetchImpl).toHaveBeenCalledWith('/__ocm/target', expect.objectContaining({ cache: 'no-store' }))
  })

  // A plain web deployment answers an unknown path with the single-page app's
  // own HTML, and that is not a proxy.
  it('页面自己回答的，不是代理', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    )

    expect(await readProxyTarget(fetchImpl as unknown as typeof fetch)).toBeNull()
  })

  it('没有代理时，答案是没有', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }))

    expect(await readProxyTarget(fetchImpl as unknown as typeof fetch)).toBeNull()
  })

  it('连不上时，答案也是没有，而不是一个异常', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    expect(await readProxyTarget(fetchImpl as unknown as typeof fetch)).toBeNull()
  })

  it('形状不对时，不当成代理', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ target: '' }))

    expect(await readProxyTarget(fetchImpl as unknown as typeof fetch)).toBeNull()
  })

  it('让代理改指向', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ target: 'https://code.example.com' }))

    const result = await writeProxyTarget('https://code.example.com', fetchImpl as unknown as typeof fetch)

    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      '/__ocm/target',
      expect.objectContaining({ method: 'PUT' }),
    )
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as { body: string }).body) as { target: string }
    expect(body.target).toBe('https://code.example.com')
  })

  it('代理不收的时候，把原因带回来', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'invalid_target', message: 'not an absolute http(s) address' }, 400),
    )

    const result = await writeProxyTarget('nope', fetchImpl as unknown as typeof fetch)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('not an absolute http(s) address')
  })

  it('代理记不住的时候，说的是记不住', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'target_not_saved', message: 'the disk said no' }, 500),
    )

    const result = await writeProxyTarget('https://code.example.com', fetchImpl as unknown as typeof fetch)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('the disk said no')
  })
})
