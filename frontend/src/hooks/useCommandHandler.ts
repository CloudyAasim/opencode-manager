import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { createBffClient } from '@/api/bff'
import { useCreateSession } from '@/hooks/useOpenCode'
import { useModelSelection } from '@/hooks/useModelSelection'
import { showToast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'
import { messageOf } from '@/lib/messageOf'
import type { Command } from '@opencode-manager/shared/api/v1'
import { useSessionStatus } from '@/stores/sessionStatusStore'

type CommandType = Command

interface CommandHandlerProps {
  /**
   * Where the layer the client talks to lives.
   *
   * A conversation is created through it rather than through the agent: the
   * layer knows who asked for it, and the browser does not have to say.
   */
  serverUrl: string
  opcodeUrl: string
  sessionID: string
  directory?: string
  onShowSessionsDialog?: () => void
  onShowModelsDialog?: () => void
  onShowHelpDialog?: () => void
  onToggleDetails?: () => boolean
  onExportSession?: () => void
  currentAgent?: string
}

export function useCommandHandler({
  serverUrl,
  opcodeUrl,
  sessionID,
  directory,
  onShowSessionsDialog,
  onShowModelsDialog,
  onShowHelpDialog,
  onToggleDetails,
  onExportSession,
  currentAgent
}: CommandHandlerProps) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const createSession = useCreateSession(serverUrl, directory)
  const { model } = useModelSelection(serverUrl, opcodeUrl, directory)
  const setSessionStatus = useSessionStatus((state) => state.setStatus)
  const [loading, setLoading] = useState(false)

  const executeCommand = useCallback(async (command: CommandType, args: string = '') => {
    if (!opcodeUrl) return

    setLoading(true)

    try {
      const client = createBffClient(serverUrl)
      const directories = directory ? [directory] : []
      // The model is the versioned API's: two fields, not one line of text.
      const promptModel = model
        ? { providerId: model.providerID, modelId: model.modelID }
        : null

      switch (command.name) {
        case 'sessions':
        case 'resume':
        case 'continue':
          onShowSessionsDialog?.()
          break

        case 'models':
          onShowModelsDialog?.()
          break

        case 'themes': {
          await client.sendCommand(sessionID, {
            command: command.name,
            arguments: args,
            workingMode: currentAgent ?? null,
            model: promptModel,
          }, directories)
          break
        }

        case 'help':
          onShowHelpDialog?.()
          break

        case 'new':
        case 'clear': {
          try {
            const newSession = await createSession.mutateAsync({})
            if (newSession?.id) {
              const currentPath = window.location.pathname
              const repoMatch = currentPath.match(/\/repos\/(\d+)\/sessions\//)
              if (repoMatch) {
                const repoId = repoMatch[1]
                const newPath = `/repos/${repoId}/sessions/${newSession.id}`
                navigate(newPath)
              } else {
                navigate('/repos')
              }
            }
          } catch (error) {
            showToast.error(t('shell.commands.sessionCreateFailed', { error: messageOf(error) }))
          }
          break
        }

        case 'details':
          if (onToggleDetails) {
            const expanded = onToggleDetails()
            showToast.success(expanded ? 'Tool details expanded' : 'Tool details collapsed')
          }
          break

        case 'export':
          if (onExportSession) {
            onExportSession()
          }
          break

        case 'compact':
        case 'summarize': {
          if (!model?.providerID || !model?.modelID) {
            showToast.error(t('session.actions.noModel'))
            break
          }

          showToast.loading(t('session.actions.compacting'), { id: `compact-${sessionID}` })

          setSessionStatus(sessionID, { type: 'compact' })

          await client.summarizeSession(
            sessionID,
            { providerId: model.providerID, modelId: model.modelID },
            directories,
          )
          break
        }

        case 'share':
        case 'unshare':
        case 'undo':
        case 'redo':
        case 'editor':
        case 'init': {
          await client.sendCommand(sessionID, {
            command: command.name,
            arguments: args,
            workingMode: currentAgent ?? null,
            model: promptModel,
          }, directories)
          break
        }

        default: {
          await client.sendCommand(sessionID, {
            command: command.name,
            arguments: args,
            workingMode: currentAgent ?? null,
            model: promptModel,
          }, directories)
        }
      }
    } catch (error) {
      showToast.error(t('shell.commands.commandFailed', { error: messageOf(error) }))
      setSessionStatus(sessionID, { type: 'idle' })
    } finally {
      setLoading(false)
    }
  }, [t, sessionID, serverUrl, opcodeUrl, directory, onShowSessionsDialog, onShowModelsDialog, onShowHelpDialog, onToggleDetails, onExportSession, createSession, navigate, model, currentAgent, setSessionStatus])

  return {
    executeCommand,
    loading
  }
}
