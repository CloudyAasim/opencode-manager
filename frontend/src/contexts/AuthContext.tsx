/* eslint-disable react-refresh/only-export-components */
import { createContext, useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react'
import { useSession, signIn, signUp, signOut, authClient, type AuthUser } from '@/lib/auth-client'
import { useNavigate, useLocation } from 'react-router-dom'
import { joinServerUrl } from '@opencode-manager/shared/utils'
import { API_BASE_URL } from '@/config'
import { rememberUser, forgetUser } from '@/lib/session-store'

interface AuthConfig {
  enabledProviders: string[]
  registrationEnabled: boolean
  isFirstUser: boolean
  adminConfigured: boolean
}

export interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  config: AuthConfig | null
  signInWithEmail: (email: string, password: string) => Promise<{ error?: string }>
  signInWithProvider: (provider: 'github' | 'google' | 'discord') => Promise<{ error?: string }>
  signInWithPasskey: () => Promise<{ error?: string }>
  signUpWithEmail: (email: string, password: string, name: string) => Promise<{ error?: string }>
  addPasskey: (name?: string) => Promise<{ error?: string }>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

/**
 * How often the session is checked against the server while the app is
 * open.
 *
 * The route loaders used to do this on every navigation. Now they read the
 * answer from one place, so something has to keep that place honest - and
 * this is it: a session that has been revoked on the server is noticed
 * here rather than on whichever navigation happened to come next.
 *
 * Five minutes is a compromise: a check on every navigation is a request
 * per navigation, and a check every five minutes is one request per five
 * minutes, with the tab getting one the moment it comes back to the
 * front.
 */
const REVALIDATE_INTERVAL_MS = 5 * 60 * 1000

export function AuthProvider({ children }: AuthProviderProps) {
  const { data: session, isPending, refetch } = useSession()
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const wasAuthenticated = useRef(false)

  const user = (session?.user as AuthUser | undefined) ?? null

  // Keep the shared session in step with what this provider knows.
  useEffect(() => {
    if (isPending) return
    rememberUser(user)
  }, [user, isPending])

  // A session that goes away is noticed here. The loaders cannot notice
  // it any more - they read the cached answer, which is the whole point -
  // so this is where the "you have been signed out" transition lives.
  useEffect(() => {
    if (isPending) return
    if (wasAuthenticated.current && !user) {
      forgetUser()
      navigate('/login', { replace: true })
    }
    wasAuthenticated.current = !!user
  }, [user, isPending, navigate])

  // Revalidate in the background, so the cached session does not go stale
  // while the app sits open.
  useEffect(() => {
    if (!user) return
    const revalidate = () => {
      void refetch()
    }
    const onFocus = () => revalidate()
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(revalidate, REVALIDATE_INTERVAL_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [user, refetch])

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(joinServerUrl(API_BASE_URL, '/api/auth-info/config'))
        if (response.ok) {
          const data = await response.json()
          setConfig(data)
        }
      } catch {
        setConfig({
          enabledProviders: ['credentials'],
          registrationEnabled: true,
          isFirstUser: true,
          adminConfigured: false,
        })
      }
    }
    fetchConfig()
  }, [])

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const result = await signIn.email({ email, password })
    if (result.error) {
      return { error: result.error.message || 'Sign in failed' }
    }
    await refetch()
    const from = (location.state as { from?: string })?.from || '/'
    navigate(from, { replace: true })
    return {}
  }, [refetch, navigate, location])

  const signInWithProvider = useCallback(async (provider: 'github' | 'google' | 'discord') => {
    try {
      await signIn.social({ provider, callbackURL: '/' })
      return {}
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'OAuth sign in failed' }
    }
  }, [])

  const signInWithPasskey = useCallback(async () => {
    try {
      const result = await authClient.signIn.passkey()
      if (result.error) {
        return { error: result.error.message || 'Passkey sign in failed' }
      }
      await refetch()
      const from = (location.state as { from?: string })?.from || '/'
      navigate(from, { replace: true })
      return {}
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Passkey sign in failed' }
    }
  }, [refetch, navigate, location])

  const signUpWithEmail = useCallback(async (email: string, password: string, name: string) => {
    const result = await signUp.email({ email, password, name })
    if (result.error) {
      return { error: result.error.message || 'Sign up failed' }
    }
    await refetch()
    navigate('/', { replace: true })
    return {}
  }, [refetch, navigate])

  const addPasskey = useCallback(async (name?: string) => {
    const result = await authClient.passkey.addPasskey({ name })
    if (result.error) {
      return { error: result.error.message || 'Failed to add passkey' }
    }
    return {}
  }, [])

  const logout = useCallback(async () => {
    forgetUser()
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = '/login'
        },
      },
    })
  }, [])

  const refreshSession = useCallback(async () => {
    await refetch()
  }, [refetch])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAuthenticated: !!user,
    isLoading: isPending,
    config,
    signInWithEmail,
    signInWithProvider,
    signInWithPasskey,
    signUpWithEmail,
    addPasskey,
    logout,
    refreshSession,
  }), [
    user,
    isPending,
    config,
    signInWithEmail,
    signInWithProvider,
    signInWithPasskey,
    signUpWithEmail,
    addPasskey,
    logout,
    refreshSession,
  ])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
