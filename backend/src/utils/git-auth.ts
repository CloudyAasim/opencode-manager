export interface GitCredential {
  name: string
  host: string
  token: string
  username?: string
}

export function isGitHubHttpsUrl(repoUrl: string): boolean {
  try {
    const parsed = new URL(repoUrl)
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
  } catch {
    return false
  }
}

export function createNoPromptGitEnv(): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: '0'
  }
}

function getDefaultUsername(host: string): string {
  try {
    const parsed = new URL(host)
    const hostname = parsed.hostname.toLowerCase()
    
    if (hostname === 'github.com') {
      return 'x-access-token'
    }
    if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
      return 'oauth2'
    }
    return 'oauth2'
  } catch {
    return 'oauth2'
  }
}

function normalizeHost(host: string): string {
  if (!host.endsWith('/')) {
    return `${host}/`
  }
  return host
}

export function createGitEnv(credentials: GitCredential[]): Record<string, string> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' }
  
  if (!credentials || credentials.length === 0) {
    return env
  }

  let configIndex = 0

  for (const cred of credentials) {
    if (!cred.host || !cred.token) {
      continue
    }

    const host = normalizeHost(cred.host)
    const username = cred.username || getDefaultUsername(host)
    const basicAuth = Buffer.from(`${username}:${cred.token}`, 'utf8').toString('base64')

    env[`GIT_CONFIG_KEY_${configIndex}`] = `http.${host}.extraheader`
    env[`GIT_CONFIG_VALUE_${configIndex}`] = `AUTHORIZATION: basic ${basicAuth}`
    configIndex++
  }

  if (configIndex > 0) {
    env.GIT_CONFIG_COUNT = String(configIndex)
  }

  return env
}

export function createGitHubGitEnv(gitToken: string): Record<string, string> {
  return createGitEnv([{ name: 'GitHub', host: 'https://github.com/', token: gitToken }])
}
