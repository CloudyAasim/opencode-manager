import { describe, it, expect } from 'vitest'
import {
  deriveUsernameFromEmail,
  isValidUsername,
  normalizeUsername,
  uniquifyUsername,
} from '@opencode-manager/shared/utils'

describe('username policy', () => {
  it('accepts letters/digits starting with a letter', () => {
    expect(isValidUsername('alice')).toBe(true)
    expect(isValidUsername('a1b2c3')).toBe(true)
    expect(isValidUsername('Alice')).toBe(true)
    expect(isValidUsername('1abc')).toBe(false)
    expect(isValidUsername('ab')).toBe(false)
    expect(isValidUsername('has-dash')).toBe(false)
    expect(isValidUsername('has_underscore')).toBe(false)
    expect(isValidUsername('a'.repeat(33))).toBe(false)
  })

  it('rejects reserved names', () => {
    expect(isValidUsername('admin')).toBe(false)
    expect(isValidUsername('repos')).toBe(false)
    expect(isValidUsername('users')).toBe(false)
    expect(isValidUsername('opencode')).toBe(false)
  })

  it('normalizes case and whitespace', () => {
    expect(normalizeUsername('  Alice ')).toBe('alice')
  })

  it('derives a valid username from an email', () => {
    expect(deriveUsernameFromEmail('Alice.Smith@example.com')).toBe('alicesmith')
    expect(deriveUsernameFromEmail('123@example.com')).toBe('u123')
    expect(deriveUsernameFromEmail('a@example.com').length).toBeGreaterThanOrEqual(3)
  })

  it('uniquifies against taken names and reserved names', () => {
    expect(uniquifyUsername('alice', (candidate) => candidate === 'alice')).toBe('alice2')
    expect(uniquifyUsername('admin', () => false)).toBe('admin2')
  })
})
