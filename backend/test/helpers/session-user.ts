import type { Session } from '../../src/auth'

export function createSessionUser(role: 'admin' | 'user'): Session['user'] {
  const now = new Date()
  return {
    id: 'me',
    name: 'Test User',
    email: 'me@example.com',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    role,
  }
}
