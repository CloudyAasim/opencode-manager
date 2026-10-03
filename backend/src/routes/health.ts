import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { readFile } from 'fs/promises'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'
const opencodeManagerVersionPromise = (async (): Promise<string | null> => {
  try {
    const packageUrl = new URL('../../../package.json', import.meta.url)
    const packageJsonRaw = await readFile(packageUrl, 'utf-8')
    const packageJson = JSON.parse(packageJsonRaw) as { version?: unknown }
    return typeof packageJson.version === 'string' ? packageJson.version : null
  } catch {
    return null
  }
})()

export function createHealthRoutes(db: Database, openCodeSupervisor?: OpenCodeSupervisor) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const opencodeManagerVersion = await opencodeManagerVersionPromise
      const dbCheck = db.prepare('SELECT 1').get()
      const lifecycle = openCodeSupervisor
        ? openCodeSupervisor.getStatus()
        : null
      const opencodeHealthy = await opencodeServerManager.checkHealth()
      const startupError = lifecycle?.lastError ?? opencodeServerManager.getLastStartupError()

      const status = lifecycle?.state === 'recovering'
        ? 'degraded'
        : startupError && !opencodeHealthy
        ? 'unhealthy'
        : (dbCheck && opencodeHealthy ? 'healthy' : 'degraded')

      const response: Record<string, unknown> = {
        status,
        timestamp: new Date().toISOString(),
        database: dbCheck ? 'connected' : 'disconnected',
        opencode: opencodeHealthy ? 'healthy' : 'unhealthy',
        opencodePort: opencodeServerManager.getPort(),
        opencodeVersion: opencodeServerManager.getVersion(),
        opencodeMinVersion: opencodeServerManager.getMinVersion(),
        opencodeVersionSupported: opencodeServerManager.isVersionSupported(),
        opencodeManagerVersion,
        opencodeRestartPending: opencodeServerManager.isRestartPending(),
      }

      if (lifecycle) {
        response.opencodeLifecycle = lifecycle
      }

      if (startupError && !opencodeHealthy) {
        response.error = startupError
      }

      return c.json(response, status === 'unhealthy' ? 503 : 200)
    } catch (error) {
      const opencodeManagerVersion = await opencodeManagerVersionPromise
      return c.json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        opencodeManagerVersion,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 503)
    }
  })

  app.get('/processes', async (c) => {
    try {
      const lifecycle = openCodeSupervisor
        ? openCodeSupervisor.getStatus()
        : null
      const opencodeHealthy = await opencodeServerManager.checkHealth()
       
      return c.json({
        opencode: {
          port: opencodeServerManager.getPort(),
          healthy: opencodeHealthy,
          lifecycle,
        },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }, 500)
    }
  })

  // Reports which build this is. It no longer asks a GitHub repository
    // whether a newer one exists: this deployment is not that repository, so
    // the answer could not be acted on.
  app.get('/version', async (c) => {
    const currentVersion = await opencodeManagerVersionPromise

    if (!currentVersion) {
      return c.json({
        currentVersion: null,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        releaseName: null
      })
    }


    return c.json({
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      releaseName: null,
    })
  })

  return app
}
