import { redirect } from 'react-router-dom'
import { joinServerUrl } from '@opencode-manager/shared/utils'
import { API_BASE_URL } from '@/config'
import { sharedUser } from './session-store'

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

/**
 * The session, without asking the server for it again.
 *
 * The loaders used to call `getSession()` themselves, which meant every
 * page switch waited for a round trip before the new page was allowed to
 * render. The session is now kept in one place and revalidated in the
 * background, so these read the answer that is already known.
 */
async function currentUser() {
  return sharedUser()
}

export async function loginLoader() {
  const [config, user] = await Promise.all([
    fetchAuthConfig(),
    currentUser(),
  ])

  if (user) {
    return redirect('/')
  }

  if (config.isFirstUser && !config.adminConfigured) {
    return redirect('/setup')
  }

  return { config }
}

export async function setupLoader() {
  const [config, user] = await Promise.all([
    fetchAuthConfig(),
    currentUser(),
  ])

  if (user) {
    return redirect('/')
  }

  if (!config.isFirstUser || config.adminConfigured) {
    return redirect('/login')
  }

  return { config }
}

export async function registerLoader() {
  const [config, user] = await Promise.all([
    fetchAuthConfig(),
    currentUser(),
  ])

  if (user) {
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
  const user = await currentUser()

  if (!user) {
    return redirect('/login')
  }

  return null
}

export async function terminalLoader() {
  const user = await currentUser()

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
  const user = await currentUser()

  if (!user) {
    return redirect('/login')
  }

  return user.role === 'admin' ? null : redirect('/settings')
}
