import { Hono } from 'hono'
import { z } from 'zod'
import { writeFileContent, readFileContent, fileExists } from '../../services/file-operations'
import { getAgentsMdPath } from '@opencode-manager/shared/config/env'
import { logger } from '../../utils/logger'
import { opencodeServerManager } from '../../services/opencode-single-server'
import { restartOpenCode } from '../../services/opencode-restart'
import { DEFAULT_AGENTS_MD } from '../../constants'
import { listManagedSkills } from '../../services/skills'
import { installOpenCodeDirectoryFiles, listOpenCodeDirectoryFiles, getOpenCodeDirectoryFile, updateOpenCodeDirectoryFile, deleteOpenCodeDirectoryFile } from '../../services/opencode-directory-files'
import { parseUploadManifest, readUploadedManifestFiles, UploadValidationError } from '../upload-utils'
import type { SettingsRouteContext } from './context'
import * as helpers from './helpers'
import { CreateCustomCommandSchema, UpdateCustomCommandSchema } from '@opencode-manager/shared/schemas'

export function createConfigEditorRoutes(ctx: SettingsRouteContext) {
  const { db, openCodeClient, openCodeSupervisor, settingsService, currentUserId } = ctx
  const app = new Hono()
  app.get('/custom-commands', async (c) => {
    try {
      const userId = currentUserId(c)
      const settings = settingsService.getSettings(userId)
      return c.json(settings.preferences.customCommands)
    } catch (error) {
      logger.error('Failed to get custom commands:', error)
      return c.json({ error: 'Failed to get custom commands' }, 500)
    }
  })

  app.post('/custom-commands', async (c) => {
    try {
      const userId = currentUserId(c)
      const body = await c.req.json()
      const validated = CreateCustomCommandSchema.parse(body)
      
      const settings = settingsService.getSettings(userId)
      const existingCommand = settings.preferences.customCommands.find(cmd => cmd.name === validated.name)
      if (existingCommand) {
        return c.json({ error: 'Command with this name already exists' }, 409)
      }
      
      settingsService.updateSettings({
        customCommands: [...settings.preferences.customCommands, validated]
      }, userId)
      
      return c.json(validated)
    } catch (error) {
      logger.error('Failed to create custom command:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid command data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to create custom command' }, 500)
    }
  })

  app.put('/custom-commands/:name', async (c) => {
    try {
      const userId = currentUserId(c)
      const commandName = decodeURIComponent(c.req.param('name'))
      const body = await c.req.json()
      const validated = UpdateCustomCommandSchema.parse(body)
      
      const settings = settingsService.getSettings(userId)
      const commandIndex = settings.preferences.customCommands.findIndex(cmd => cmd.name === commandName)
      if (commandIndex === -1) {
        return c.json({ error: 'Command not found' }, 404)
      }
      
      const updatedCommands = [...settings.preferences.customCommands]
      updatedCommands[commandIndex] = {
        name: commandName,
        description: validated.description,
        promptTemplate: validated.promptTemplate
      }
      
      settingsService.updateSettings({
        customCommands: updatedCommands
      }, userId)
      
      return c.json(updatedCommands[commandIndex])
    } catch (error) {
      logger.error('Failed to update custom command:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid command data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update custom command' }, 500)
    }
  })

  app.delete('/custom-commands/:name', async (c) => {
    try {
      const userId = currentUserId(c)
      const commandName = decodeURIComponent(c.req.param('name'))
      
      const settings = settingsService.getSettings(userId)
      const commandExists = settings.preferences.customCommands.some(cmd => cmd.name === commandName)
      if (!commandExists) {
        return c.json({ error: 'Command not found' }, 404)
      }
      
      const updatedCommands = settings.preferences.customCommands.filter(cmd => cmd.name !== commandName)
      settingsService.updateSettings({
        customCommands: updatedCommands
      }, userId)
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete custom command:', error)
      return c.json({ error: 'Failed to delete custom command' }, 500)
    }
  })

  app.get('/agents-md', async (c) => {
    try {
      const agentsMdPath = getAgentsMdPath()
      const exists = await fileExists(agentsMdPath)
      
      if (!exists) {
        return c.json({ content: '' })
      }
      
      const content = await readFileContent(agentsMdPath)
      return c.json({ content })
    } catch (error) {
      logger.error('Failed to get AGENTS.md:', error)
      return c.json({ error: 'Failed to get AGENTS.md' }, 500)
    }
  })

  app.get('/agents-md/default', async (c) => {
    return c.json({ content: DEFAULT_AGENTS_MD })
  })

  app.put('/agents-md', async (c) => {
    try {
      const body = await c.req.json()
      const { content } = z.object({ content: z.string() }).parse(body)
      
      const agentsMdPath = getAgentsMdPath()
      await writeFileContent(agentsMdPath, content)
      logger.info(`Updated AGENTS.md at: ${agentsMdPath}`)
      
      await restartOpenCode(openCodeSupervisor)
      logger.info('Restarted OpenCode server after AGENTS.md update')
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to update AGENTS.md:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update AGENTS.md' }, 500)
    }
  })

  app.get('/skills', async (c) => {
    try {
      const repoId = helpers.parseOptionalRepoId(c.req.query('repoId'))
      const directory = c.req.query('directory')
      
      const skills = await listManagedSkills(db, openCodeClient, repoId, directory)
      return c.json(skills)
    } catch (error) {
      logger.error('Failed to list skills:', error)
      return c.json({ error: 'Failed to list skills' }, 500)
    }
  })

  app.post('/opencode-directory-files/install', async (c) => {
    try {
      const contentType = c.req.header('content-type') || ''
      if (!contentType.includes('multipart/form-data')) {
        return c.json({ error: 'Unsupported content type. Use multipart/form-data' }, 400)
      }

      const formData = await c.req.parseBody({ all: true })
      const kind = z.enum(['agents', 'commands']).parse(formData['kind'])

      const manifest = parseUploadManifest(formData['fileManifest'])
      const markdownManifest = helpers.getMarkdownUploadManifest(manifest)
      if (markdownManifest.length === 0) {
        return c.json({ error: `No markdown ${kind} files found` }, 400)
      }

      const files = await readUploadedManifestFiles(formData, markdownManifest)

      const result = await installOpenCodeDirectoryFiles(kind, files)
      opencodeServerManager.markRestartPending()

      return c.json({ ...result, restartRequired: true })
    } catch (error) {
      logger.error('Failed to install OpenCode directory files:', error)

      if (error instanceof UploadValidationError) {
        return c.json({ error: error.message }, 400)
      }

      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid upload data', details: error.issues }, 400)
      }

      if (error instanceof Error) {
        const status = helpers.matchErrorStatus(helpers.OPENCODE_DIRECTORY_UPLOAD_ERROR_STATUS, error)
        if (status) {
          return c.json({ error: error.message }, status)
        }
      }

      return c.json({ error: 'Failed to install OpenCode directory files' }, 500)
    }
  })

  app.get('/opencode-directory-files', async (c) => {
    try {
      const kind = z.enum(['agents', 'commands']).parse(c.req.query('kind'))
      return c.json(await listOpenCodeDirectoryFiles(kind))
    } catch (error) {
      logger.error('Failed to list OpenCode directory files:', error)

      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid file kind', details: error.issues }, 400)
      }

      return c.json({ error: 'Failed to list OpenCode directory files' }, 500)
    }
  })

  app.get('/opencode-directory-files/content', async (c) => {
    try {
      const kind = z.enum(['agents', 'commands']).parse(c.req.query('kind'))
      const relativePath = z.string().min(1).parse(c.req.query('relativePath'))
      return c.json(await getOpenCodeDirectoryFile(kind, relativePath))
    } catch (error) {
      return helpers.handleOpenCodeDirectoryFileError(c, error, 'read')
    }
  })

  app.put('/opencode-directory-files', async (c) => {
    try {
      const body = await c.req.json()
      const { kind, relativePath, content } = z
        .object({
          kind: z.enum(['agents', 'commands']),
          relativePath: z.string().min(1),
          content: z.string(),
        })
        .parse(body)

      const result = await updateOpenCodeDirectoryFile(kind, relativePath, content)
      opencodeServerManager.markRestartPending()

      return c.json({ ...result, restartRequired: true })
    } catch (error) {
      return helpers.handleOpenCodeDirectoryFileError(c, error, 'update')
    }
  })

  app.delete('/opencode-directory-files', async (c) => {
    try {
      const kind = z.enum(['agents', 'commands']).parse(c.req.query('kind'))
      const relativePath = z.string().min(1).parse(c.req.query('relativePath'))

      await deleteOpenCodeDirectoryFile(kind, relativePath)
      opencodeServerManager.markRestartPending()

      return c.json({ kind, relativePath, restartRequired: true })
    } catch (error) {
      return helpers.handleOpenCodeDirectoryFileError(c, error, 'delete')
    }
  })

  return app
}
