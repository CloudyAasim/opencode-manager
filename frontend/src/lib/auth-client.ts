import { createAuthClient } from 'better-auth/react'
import { passkeyClient } from '@better-auth/passkey/client'
import { API_BASE_URL } from '@/config'

const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/auth`
  }
  return `${API_BASE_URL}/api/auth`
}

export const authClient = createAuthClient({
  baseURL: getBaseUrl(),
  plugins: [passkeyClient()],
})

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  changePassword,
} = authClient

export const passkey = authClient.passkey

export type AuthSession = typeof authClient.$Infer.Session
export type UserRole = 'admin' | 'user'
export type AuthUser = AuthSession['user'] & { role?: UserRole; username?: string | null }
