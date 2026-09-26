import { describe, it, expect } from 'vitest'
import { isInternalSignupAllowed, withInternalSignup } from '../../src/auth/internal-signup'

describe('internal signup context', () => {
  it('is disabled by default', () => {
    expect(isInternalSignupAllowed()).toBe(false)
  })

  it('stays enabled across await boundaries inside the wrapped operation', async () => {
    await withInternalSignup(async () => {
      expect(isInternalSignupAllowed()).toBe(true)
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(isInternalSignupAllowed()).toBe(true)
    })
  })

  it('is isolated from concurrent work outside the operation', async () => {
    const observed: boolean[] = []

    await Promise.all([
      withInternalSignup(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        observed.push(isInternalSignupAllowed())
      }),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        observed.push(isInternalSignupAllowed())
      })(),
    ])

    expect(observed).toContain(true)
    expect(observed).toContain(false)
  })
})
