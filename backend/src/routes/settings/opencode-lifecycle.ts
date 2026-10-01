import { Hono } from 'hono'
import { z } from 'zod'
import { archiveBrokenOpenCodeConfigFile, deleteOpenCodeConfigFile } from '../../services/opencode-config-file'
import { restoreLastKnownGoodOpenCodeConfig } from '../../services/opencode-config-apply'
import { logger } from '../../utils/logger'
import { execWithTimeout } from '../../utils/process'
import { ValidationError, UpstreamUnavailableError, ServiceUnavailableError } from '../../utils/errors'
import { opencodeServerManager, ConfigReloadError, resolveOpenCodeExecutable } from '../../services/opencode-single-server'
import { restartOpenCode, reloadOpenCodeConfig } from '../../services/opencode-restart'
import { compareVersions, isValidVersion } from '../../utils/version-utils'
import { getImportedSessionDirectories, getOpenCodeImportStatus, OpenCodeImportProtectionError, syncOpenCodeImport } from '../../services/opencode-import'
import { relinkReposFromSessionDirectories } from '../../services/repo'
import type { SettingsRouteContext } from './context'
import * as helpers from './helpers'
import { SyncOpenCodeImportSchema } from '@opencode-manager/shared/schemas'
import { githubFetch } from '../../utils/github'

export function createOpenCodeLifecycleRoutes(ctx: SettingsRouteContext) {
  const { db, gitAuthService, openCodeSupervisor, settingsService } = ctx
  const app = new Hono()
  app.post('/opencode-restart', async (c) => {
    try {
      logger.info('Manual OpenCode server restart requested')
      opencodeServerManager.clearStartupError()
      const { resumedSessionIDs } = await restartOpenCode(openCodeSupervisor)
      return c.json({
        success: true,
        message: 'OpenCode server restarted successfully',
        resumedSessions: resumedSessionIDs,
      })
    } catch (error) {
      logger.error('Failed to restart OpenCode server:', error)
      const startupError = opencodeServerManager.getLastStartupError()
      return c.json({
        error: 'Failed to restart OpenCode server',
        details: startupError || (error instanceof Error ? error.message : 'Unknown error')
      }, 500)
    }
  })

  app.get('/opencode-import/status', async (c) => {
    try {
      return c.json(await getOpenCodeImportStatus())
    } catch (error) {
      logger.error('Failed to get OpenCode import status:', error)
      return c.json({
        error: 'Failed to get OpenCode import status',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/opencode-import', async (c) => {
    try {
      const rawBody = c.req.header('content-type')?.includes('application/json') ? await c.req.json() : {}
      const body = SyncOpenCodeImportSchema.parse(rawBody)
      const result = await syncOpenCodeImport({
        overwriteState: body.overwriteState ?? false,
        protectExistingState: true,
        settingsService,
      })

      if (!result.configImported && !result.stateImported) {
        return c.json({
          error: 'No importable OpenCode host data found',
          ...result,
        }, 404)
      }

      let relinkedRepos
      if (result.stateImported) {
        const importedSessions = await getImportedSessionDirectories(result.workspaceStatePath)
        relinkedRepos = await relinkReposFromSessionDirectories(db, gitAuthService, importedSessions.directories)
      } else {
        relinkedRepos = {
          repos: [],
          relinkedCount: 0,
          existingCount: 0,
          nonRepoPathCount: 0,
          duplicatePathCount: 0,
          errors: [],
        }
      }

      opencodeServerManager.clearStartupError()
      await restartOpenCode(openCodeSupervisor)

      return c.json({
        success: true,
        message: 'Imported existing OpenCode host data and restarted the server',
        serverRestarted: true,
        relinkedRepos,
        ...result,
      })
    } catch (error) {
      logger.error('Failed to import existing OpenCode host data:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid OpenCode import request', details: error.issues }, 400)
      }
      if (error instanceof OpenCodeImportProtectionError) {
        return c.json({
          error: error.message,
          code: error.code,
          detail: error.detail,
        }, 409)
      }
      return c.json({
        error: 'Failed to import existing OpenCode host data',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/opencode-reload', async (c) => {
    try {
      logger.info('OpenCode configuration reload requested')
      const { resumedSessionIDs } = await reloadOpenCodeConfig(openCodeSupervisor)
      return c.json({
        success: true,
        message: 'OpenCode server restarted with the current configuration',
        resumedSessions: resumedSessionIDs,
      })
    } catch (error) {
      logger.error('Failed to reload OpenCode config:', error)
      if (error instanceof ConfigReloadError) {
        const details = error.validationIssues.length > 0
          ? error.validationIssues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
          : error.message
        return c.json({
          error: error.message,
          details,
          validationIssues: error.validationIssues,
        }, 500)
      }
      return c.json({
        error: 'Failed to reload OpenCode configuration',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/opencode-rollback', async (c) => {
    try {
      logger.info('OpenCode config rollback requested')

      const restored = await restoreLastKnownGoodOpenCodeConfig(settingsService)
      if (!restored) {
        return c.json({ error: 'No previous working config available for rollback' }, 404)
      }

      logger.info('Rolled back to the previous working config')

      try {
        await reloadOpenCodeConfig(openCodeSupervisor)
      } catch (reloadError) {
        logger.error('Rollback config reload failed, attempting restart:', reloadError)

        await archiveBrokenOpenCodeConfigFile()
        const deleted = await deleteOpenCodeConfigFile()
        if (deleted) {
          logger.info('Deleted filesystem config, attempting restart with fallback')
          await new Promise(r => setTimeout(r, 1000))

          opencodeServerManager.clearStartupError()
          await restartOpenCode(openCodeSupervisor)

          return c.json({
            success: true,
            message: 'Server restarted after deleting the broken config file. The previous working config remains available for rollback.',
            fallback: true,
          })
        }

        return c.json({
          error: 'Failed to rollback and could not delete filesystem config',
          details: reloadError instanceof Error ? reloadError.message : 'Unknown error'
        }, 500)
      }

      return c.json({
        success: true,
        message: 'Server reloaded with the previous working config',
      })
    } catch (error) {
      logger.error('Failed to rollback OpenCode config:', error)
      return c.json({ error: 'Failed to rollback OpenCode config' }, 500)
    }
  })

  app.post('/opencode-upgrade', async (c) => {
    const oldVersion = opencodeServerManager.getVersion()
    logger.info(`Current OpenCode version: ${oldVersion}`)

    try {
      const installMethod = helpers.getOpenCodeInstallMethod()
      const openCodeExecutable = resolveOpenCodeExecutable() ?? 'opencode'
      logger.info(`Running opencode upgrade --method ${installMethod} with 90s timeout...`)
      const { output: upgradeOutput, timedOut } = execWithTimeout([openCodeExecutable, 'upgrade', '--method', installMethod], 90000)
      logger.info(`Upgrade output: ${upgradeOutput}`)

      if (timedOut) {
        logger.warn('OpenCode upgrade timed out after 90 seconds')
        throw new ServiceUnavailableError('Upgrade command timed out after 90 seconds')
      }

      const newVersion = await opencodeServerManager.fetchVersion()
      logger.info(`New OpenCode version: ${newVersion}`)

      const upgraded = oldVersion && newVersion && compareVersions(newVersion, oldVersion) > 0

      if (upgraded) {
        logger.info(`OpenCode upgraded from v${oldVersion} to v${newVersion}`)
        opencodeServerManager.clearStartupError()
        await restartOpenCode(openCodeSupervisor)
        logger.info('OpenCode server restarted after upgrade')

        return c.json({
          success: true,
          message: `OpenCode upgraded from v${oldVersion} to v${newVersion} and restarted`,
          oldVersion,
          newVersion,
          upgraded: true
        })
      } else {
        logger.info('OpenCode is already up to date or version unchanged')
        return c.json({
          success: true,
          message: 'OpenCode is already up to date',
          oldVersion,
          newVersion,
          upgraded: false
        })
      }
    } catch (error) {
      logger.error('Failed to upgrade OpenCode:', error)
      logger.warn('Attempting to recover OpenCode server...')

      let recovered = false
      let recoveryMessage = ''

      opencodeServerManager.clearStartupError()
      try {
        await restartOpenCode(openCodeSupervisor)
        logger.warn('OpenCode server restarted after upgrade failure')
        recovered = true
        recoveryMessage = 'Server recovered'
      } catch (recoveryError) {
        logger.error('Failed to recover OpenCode server:', recoveryError)
        recovered = false
        recoveryMessage = recoveryError instanceof Error ? recoveryError.message : 'Unknown error'
      }

      let currentVersion: string | null | undefined = oldVersion
      try {
        currentVersion = opencodeServerManager.getVersion() || oldVersion
      } catch (versionError) {
        logger.error('Failed to get version after recovery:', versionError)
        currentVersion = oldVersion
      }

      return c.json(
        recovered ? {
          success: false,
          error: 'Upgrade failed but server recovered',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          upgraded: false,
          recovered: true,
          recoveryMessage
        } : {
          error: 'Failed to upgrade OpenCode and could not recover',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          upgraded: false,
          recovered: false,
          recoveryMessage
        },
        recovered ? 400 : 500
      )
    }
  })

  app.get('/opencode-versions', async (c) => {
    try {
      logger.info('Fetching available OpenCode versions from GitHub')
      
      const response = await githubFetch('https://api.github.com/repos/sst/opencode/releases?per_page=20', {
        accept: 'application/vnd.github.v3+json',
      })
      
      if (!response.ok) {
        throw new UpstreamUnavailableError(`GitHub API returned ${response.status}`)
      }
      
      const releases = await response.json() as Array<{
        tag_name: string
        name: string
        published_at: string
        prerelease: boolean
      }>

      const versions = releases
        .filter(r => !r.prerelease)
        .map(r => {
          const version = r.tag_name.replace(/^v/, '')
          return {
            version,
            tag: r.tag_name,
            name: r.name,
            publishedAt: r.published_at,
          }
        })
      
      const currentVersion = opencodeServerManager.getVersion()
      
      return c.json({
        versions,
        currentVersion
      })
    } catch (error) {
      logger.error('Failed to fetch OpenCode versions:', error)
      return c.json({
        error: 'Failed to fetch versions',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/opencode-install-version', async (c) => {
    const oldVersion = opencodeServerManager.getVersion()
    logger.info(`Current OpenCode version: ${oldVersion}`)

    try {
      const body = await c.req.json()
      const { version } = z.object({ version: z.string().min(1) }).parse(body)

      const versionWithoutPrefix = version.replace(/^v/, '')
      if (!isValidVersion(versionWithoutPrefix)) {
        throw new ValidationError('Invalid version format. Must be in MAJOR.MINOR.PATCH format (e.g., 1.2.27)')
      }

      logger.info(`Installing OpenCode version: ${version}`)
      const versionArg = version.startsWith('v') ? version : `v${version}`
      const installMethod = helpers.getOpenCodeInstallMethod()
      const openCodeExecutable = resolveOpenCodeExecutable() ?? 'opencode'
      logger.info(`Running opencode upgrade ${versionArg} --method ${installMethod} with 90s timeout...`)

      const { output: upgradeOutput, timedOut } = execWithTimeout(
        [openCodeExecutable, 'upgrade', versionArg, '--method', installMethod],
        90000
      )
      logger.info(`Upgrade output: ${upgradeOutput}`)

      if (timedOut) {
        logger.warn('OpenCode version install timed out after 90 seconds')
        throw new ServiceUnavailableError('Version install command timed out after 90 seconds')
      }

      const newVersion = await opencodeServerManager.fetchVersion()
      logger.info(`New OpenCode version: ${newVersion}`)

      if (newVersion !== versionWithoutPrefix) {
        throw new ServiceUnavailableError(`OpenCode version install did not result in the requested version ${versionWithoutPrefix}; detected ${newVersion ?? 'unknown'}`)
      }

      opencodeServerManager.clearStartupError()
      await restartOpenCode(openCodeSupervisor)
      logger.info('OpenCode server restarted after version change')

      return c.json({
        success: true,
        message: `OpenCode ${oldVersion ? `changed from v${oldVersion} to` : 'installed as'} v${newVersion}`,
        oldVersion,
        newVersion
      })
    } catch (error) {
      logger.error('Failed to install OpenCode version:', error)
      logger.warn('Attempting to recover OpenCode server...')

      let recovered = false
      let recoveryMessage = ''

      opencodeServerManager.clearStartupError()
      try {
        await restartOpenCode(openCodeSupervisor)
        logger.warn('OpenCode server restarted after install failure')
        recovered = true
        recoveryMessage = 'Server recovered'
      } catch (recoveryError) {
        logger.error('Failed to recover OpenCode server:', recoveryError)
        recovered = false
        recoveryMessage = recoveryError instanceof Error ? recoveryError.message : 'Unknown error'
      }

      const currentVersion = opencodeServerManager.getVersion() || oldVersion

      return c.json(
        recovered ? {
          success: false,
          error: 'Version install failed but server recovered',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          recovered: true,
          recoveryMessage
        } : {
          error: 'Failed to install OpenCode version and could not recover',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          recovered: false,
          recoveryMessage
        },
        recovered ? 400 : 500
      )
    }
  })

  return app
}
