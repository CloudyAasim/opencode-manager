import { describe, it, expect } from 'vitest'
import { swallow } from './swallow'

describe('swallow', () => {
  it('returns undefined so it can be used as a catch handler', () => {
    expect(swallow()).toBeUndefined()
  })

  it('is usable directly as a promise rejection handler', async () => {
    await expect(Promise.reject(new Error('boom')).catch(swallow)).resolves.toBeUndefined()
  })
})
