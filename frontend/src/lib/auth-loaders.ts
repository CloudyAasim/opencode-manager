import { redirect } from 'react-router-dom'
import { getSession } from './auth-client'
import { joinServerUrl } from '@opencode-manager/shared/utils'
import { API_BASE_URL } from '@/config'

export interface AuthConfig {
  enabledProviders: string[]
  registrationEnabled: boolean
  isFirstUser: boolean
  adminConfigured: boolean
}

async function fetchAuthConfig(): Promise<AuthConfig> {
  const defaultConfig: AuthConfig = {
    enabledProviders: ['credentials'],
    registrationEnabled: true,
    isFirstUser: false,
    adminConfigured: false,
  }
  const response = await fetch(joinServerUrl(API_BASE_URL, '/api/auth-info/config'))
  if (!response.ok) {
    return defaultConfig
  }
  try {
    return await response.json()
  } catch {
    return defaultConfig
  }
}

export async function loginLoader() {
  const [config, session] = await Promise.all([
    fetchAuthConfig(),
    getSession(),
  ])

  if (session.data?.user) {
    return redirect('/')
  }

  if (config.isFirstUser && !config.adminConfigured) {
    return redirect('/setup')
  }

  return { config }
}

export async function setupLoader() {
  const [config, session] = await Promise.all([
    fetchAuthConfig(),
    getSession(),
  ])

  if (session.data?.user) {
    return redirect('/')
  }

  if (!config.isFirstUser || config.adminConfigured) {
    return redirect('/login')
  }

  return { config }
}

export async function registerLoader() {
  const [config, session] = await Promise.all([
    fetchAuthConfig(),
    getSession(),
  ])

  if (session.data?.user) {
    return redirect('/')
  }

  if (!config.registrationEnabled) {
    return redirect('/login')
  }

  if (config.isFirstUser && !config.adminConfigured) {
    return redirect('/setup')
  }

  return { config }
}

export async function protectedLoader() {
  const session = await getSession()

  if (!session.data?.user) {
    return redirect('/login')
  }

  return null
}

export async function terminalLoader() {
  const session = await getSession()
  const user = session.data?.user as { role?: string } | undefined

  if (!user) {
    return redirect('/login')
  }

  if (user.role === 'admin') {
    return null
  }

  try {
    const response = await fetch(joinServerUrl(API_BASE_URL, '/api/terminal/config'))
    if (response.ok) {
      const config = (await response.json()) as { enabled?: boolean; adminsOnly?: boolean }
      if (config.enabled && !config.adminsOnly) {
        return null
      }
    }
  } catch {
    return redirect('/')
  }

  return redirect('/')
}

/**
 * The OpenCode configuration writes one shared document that every session on
 * the server reads, so the route is closed to administrators only.
 *
 * Redirecting rather than rendering a 403 keeps the URL out of a tenant's
 * history and sends them somewhere they can actually do something.
 */
export async function openCodeSettingsLoader() {
  const session = await getSession()
  const user = session.data?.user as { role?: string } | undefined

  if (!user) {
    return redirect('/login')
  }

  return user.role === 'admin' ? null : redirect('/settings')
}
