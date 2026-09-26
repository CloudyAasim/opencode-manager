import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { SettingsList, SettingsListRow } from '@/components/ui/settings-list'
import { CommandDialog } from './CommandDialog'
import { UploadFolderButton } from './UploadFolderButton'
import { DirectoryFilesList } from './DirectoryFilesList'
import { useI18n } from '@/lib/i18n'
import type { OpenCodeDirectoryFileInfo } from '@/api/types/settings'

interface Command {
  template: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
  topP?: number
}

interface CommandsEditorProps {
  commands: Record<string, Command>
  directoryCommands?: OpenCodeDirectoryFileInfo[]
  onChange: (commands: Record<string, Command>) => void
}

export function CommandsEditor({ commands, directoryCommands = [], onChange }: CommandsEditorProps) {
  const { t } = useI18n()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingCommand, setEditingCommand] = useState<{ name: string; command: Command } | null>(null)
  const hasCommands = Object.keys(commands).length > 0 || directoryCommands.length > 0

  const handleCommandSubmit = (name: string, command: Command) => {
    if (editingCommand) {
      const updatedCommands = { ...commands }
      delete updatedCommands[editingCommand.name]
      updatedCommands[name] = command
      onChange(updatedCommands)
      setEditingCommand(null)
    } else {
      const updatedCommands = {
        ...commands,
        [name]: command
      }
      onChange(updatedCommands)
      setIsCreateDialogOpen(false)
    }
  }

  const deleteCommand = (name: string) => {
    const updatedCommands = { ...commands }
    delete updatedCommands[name]
    onChange(updatedCommands)
  }

  const startEdit = (name: string, command: Command) => {
    setEditingCommand({ name, command })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <UploadFolderButton kind="commands" />
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              {t('settingsPanels.commandsEditor.addCommand')}
            </Button>
          </DialogTrigger>
          <CommandDialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
            onSubmit={handleCommandSubmit}
          />
        </Dialog>
      </div>

      <SettingsList
        isEmpty={!hasCommands}
        emptyTitle={t('settingsPanels.commandsEditor.emptyTitle')}
        emptyHint={t('settingsPanels.commandsEditor.emptyHint')}
        maxHeightClassName="max-h-[calc(100dvh-300px)] sm:max-h-[420px]"
      >
        {Object.entries(commands).map(([name, command]) => (
          <SettingsListRow
            key={name}
            title={name}
            description={command.description}
            badges={
              command.agent && <Badge variant="outline" className="shrink-0">{command.agent}</Badge>
            }
            onClick={() => startEdit(name, command)}
            primaryAction={{ label: t('settingsPanels.commandsEditor.edit'), onClick: () => startEdit(name, command) }}
            actions={[{ label: t('settingsPanels.commandsEditor.delete'), destructive: true, onClick: () => deleteCommand(name) }]}
            actionsLabel={t('settingsPanels.commandsEditor.actionsFor', { name })}
          />
        ))}
        <DirectoryFilesList kind="commands" files={directoryCommands} />
      </SettingsList>

      <CommandDialog
        open={!!editingCommand}
        onOpenChange={() => setEditingCommand(null)}
        onSubmit={handleCommandSubmit}
        editingCommand={editingCommand}
      />
    </div>
  )
}
