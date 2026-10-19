import { describe, it, expect } from 'vitest'
import { canAnswerHostKeyPrompt } from './canAnswerHostKeyPrompt'

/**
 * The prompt is broadcast to every connected client, so every signed-in
 * account receives the `requestId`. Answering it writes into `known_hosts`,
 * which every git operation on the host then trusts - so it is admin-only, and
 * the dialog is not offered to anyone else.
 *
 * This is the UI half of a rule the route enforces; it is what stops an
 * ordinary account being shown a dialog whose both buttons answer 403.
 */
describe('canAnswerHostKeyPrompt', () => {
  it('offers the prompt to an admin', () => {
    expect(canAnswerHostKeyPrompt({ role: 'admin' })).toBe(true)
  })

  it('does not offer it to an ordinary account', () => {
    expect(canAnswerHostKeyPrompt({ role: 'user' })).toBe(false)
  })

  it('does not offer it to an account whose role is unknown or missing', () => {
    // A user object without a role is what a stale or partial session looks
    // like. Offering the dialog and then 403ing is worse than not offering it.
    expect(canAnswerHostKeyPrompt({})).toBe(false)
    expect(canAnswerHostKeyPrompt({ role: undefined })).toBe(false)
    expect(canAnswerHostKeyPrompt(null)).toBe(false)
    expect(canAnswerHostKeyPrompt(undefined)).toBe(false)
  })

  it('does not treat an unexpected role as an admin', () => {
    expect(canAnswerHostKeyPrompt({ role: 'Admin' })).toBe(false)
    expect(canAnswerHostKeyPrompt({ role: 'admin ' })).toBe(false)
    expect(canAnswerHostKeyPrompt({ role: 'superuser' })).toBe(false)
  })
})
