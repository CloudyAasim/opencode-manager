import { Hono } from 'hono'
import { z } from 'zod'
import { CreateSkillRequestSchema, UpdateSkillRequestSchema, SkillScopeSchema, InstallSkillFromGithubRequestSchema, InstallSkillUploadRequestSchema } from '@opencode-manager/shared'
import { logger } from '../../utils/logger'
import { opencodeServerManager } from '../../services/opencode-single-server'
import { getSkill, createSkill, updateSkill, deleteSkill, installSkillFromGithubTree, installSkillFromUploadedFiles } from '../../services/skills'
import { parseUploadManifest, readUploadedManifestFiles, UploadValidationError } from '../upload-utils'
import type { SettingsRouteContext } from './context'
import * as helpers from './helpers'

export function createSkillsRoutes(ctx: SettingsRouteContext) {
  const { db, openCodeClient, openCodeSupervisor } = ctx
  const app = new Hono()
  app.post('/skills/install', async (c) => {
    try {
      const contentType = c.req.header('content-type') || ''

      if (contentType.includes('application/json')) {
        const body = await c.req.json()
        const validated = InstallSkillFromGithubRequestSchema.parse(body)

        if (validated.scope === 'project' && validated.repoId === undefined) {
          return c.json({ error: 'repoId is required for project scope' }, 400)
        }

        const result = await installSkillFromGithubTree(db, validated)

        const restartRequired = await helpers.reloadAfterSkillInstall(db, openCodeClient, openCodeSupervisor, validated.scope, validated.repoId)

        return c.json({ ...result, restartRequired })
      }

      if (contentType.includes('multipart/form-data')) {
        const formData = await c.req.parseBody({ all: true })

        const scope = formData['scope']
        const repoIdValue = formData['repoId']
        const overwriteValue = formData['overwrite']

        const manifest = parseUploadManifest(formData['fileManifest'])

        const repoId = helpers.parseOptionalRepoId(repoIdValue as string | undefined)
        const overwrite = helpers.parseBooleanFormValue(overwriteValue)

        const uploadRequest = InstallSkillUploadRequestSchema.parse({
          sourceType: 'upload',
          scope,
          repoId,
          overwrite,
        })

        if (scope === 'project' && repoId === undefined) {
          return c.json({ error: 'repoId is required for project scope' }, 400)
        }

        if (manifest.length === 0) {
          return c.json({ error: 'fileManifest must contain at least one entry' }, 400)
        }

        const files = await readUploadedManifestFiles(formData, manifest)

        const result = await installSkillFromUploadedFiles(db, uploadRequest, files)

        const restartRequired = await helpers.reloadAfterSkillInstall(db, openCodeClient, openCodeSupervisor, uploadRequest.scope, uploadRequest.repoId)

        return c.json({ ...result, restartRequired })
      }

      return c.json({ error: 'Unsupported content type. Use application/json or multipart/form-data' }, 400)
    } catch (error) {
      logger.error('Failed to install skill:', error)

      if (error instanceof UploadValidationError) {
        return c.json({ error: error.message }, 400)
      }

      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid skill install data', details: error.issues }, 400)
      }

      if (error instanceof Error) {
        const status = helpers.matchErrorStatus(helpers.SKILL_INSTALL_ERROR_STATUS, error)
        if (status) {
          return c.json({ error: error.message }, status)
        }
      }

      return c.json({ error: 'Failed to install skill' }, 500)
    }
  })

  app.get('/skills/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const scope = SkillScopeSchema.parse(c.req.query('scope'))
      const repoId = helpers.parseOptionalRepoId(c.req.query('repoId'))

      if (scope === 'project' && !repoId) {
        return c.json({ error: 'repoId is required for project scope' }, 400)
      }

      const skill = await getSkill(db, openCodeClient, name, scope, repoId)
      return c.json(skill)
    } catch (error) {
      logger.error('Failed to get skill:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid scope parameter. Must be "global" or "project"' }, 400)
      }
      if (error instanceof Error && error.message.includes('Invalid repoId')) {
        return c.json({ error: error.message }, 400)
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: error.message }, 404)
      }
      if (error instanceof Error && error.message.includes('Invalid skill name')) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: 'Failed to get skill' }, 500)
    }
  })

  app.post('/skills', async (c) => {
    try {
      const body = await c.req.json()
      const validated = CreateSkillRequestSchema.parse(body)

      const skill = await createSkill(db, validated)

      opencodeServerManager.markRestartPending()

      return c.json({ ...skill, restartRequired: true })
    } catch (error) {
      logger.error('Failed to create skill:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid skill data', details: error.issues }, 400)
      }
      if (error instanceof Error && error.message.includes('already exists')) {
        return c.json({ error: error.message }, 409)
      }
      return c.json({ error: 'Failed to create skill' }, 500)
    }
  })

  app.put('/skills/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const scope = SkillScopeSchema.parse(c.req.query('scope'))
      const repoId = helpers.parseOptionalRepoId(c.req.query('repoId'))
      const body = await c.req.json()
      const validated = UpdateSkillRequestSchema.parse(body)

      if (scope === 'project' && !repoId) {
        return c.json({ error: 'repoId is required for project scope' }, 400)
      }

      const skill = await updateSkill(db, openCodeClient, name, scope, validated, repoId)

      opencodeServerManager.markRestartPending()

      return c.json({ ...skill, restartRequired: true })
    } catch (error) {
      logger.error('Failed to update skill:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      if (error instanceof Error && error.message.includes('Invalid repoId')) {
        return c.json({ error: error.message }, 400)
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: error.message }, 404)
      }
      if (error instanceof Error && error.message.includes('Invalid skill name')) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: 'Failed to update skill' }, 500)
    }
  })

  app.delete('/skills/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const scope = SkillScopeSchema.parse(c.req.query('scope'))
      const repoId = helpers.parseOptionalRepoId(c.req.query('repoId'))

      if (scope === 'project' && !repoId) {
        return c.json({ error: 'repoId is required for project scope' }, 400)
      }

      await deleteSkill(db, name, scope, repoId)

      opencodeServerManager.markRestartPending()

      return c.json({ success: true, restartRequired: true })
    } catch (error) {
      logger.error('Failed to delete skill:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid scope parameter. Must be "global" or "project"' }, 400)
      }
      if (error instanceof Error && error.message.includes('Invalid repoId')) {
        return c.json({ error: error.message }, 400)
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: error.message }, 404)
      }
      if (error instanceof Error && error.message.includes('Invalid skill name')) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: 'Failed to delete skill' }, 500)
    }
  })

  return app
}
