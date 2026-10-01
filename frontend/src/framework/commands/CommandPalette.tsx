import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/lib/i18n'
import { useLayer } from '@/framework/layer/useLayer'
import { useCommandList } from './commandRegistry'
import { COMMAND_PALETTE_LAYER, type AppCommand } from './types'

interface PaletteEntry {
  command: AppCommand
  label: string
  score: number
}

function scoreCommand(command: AppCommand, term: string, label: string): number {
  if (!term) return 3
  const needle = term.toLowerCase()
  const haystack = `${label} ${command.keywords?.join(' ') ?? ''}`.toLowerCase()
  if (label.toLowerCase() === needle) return 0
  if (label.toLowerCase().startsWith(needle)) return 1
  if (haystack.includes(needle)) return 2
  return -1
}

export function CommandPalette() {
  const { t } = useI18n()
  const [isOpen, setOpen] = useLayer(COMMAND_PALETTE_LAYER)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const commands = useCommandList()

  const entries = useMemo<PaletteEntry[]>(
    () =>
      commands
        .map((command) => {
          const label = command.label ?? t(command.labelKey)
          return { command, label, score: scoreCommand(command, query, label) }
        })
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label)),
    [commands, query, t],
  )

  const close = () => {
    setQuery('')
    setHighlighted(0)
    setOpen(false)
  }

  const runEntry = (entry: PaletteEntry | undefined) => {
    if (!entry) return
    close()
    entry.command.run()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent className="max-w-lg gap-0 p-0" hideCloseButton>
        <DialogHeader className="px-3 pt-3">
          <DialogTitle className="sr-only">{t('shell.commands.title')}</DialogTitle>
          <Input
            autoFocus
            value={query}
            placeholder={t('shell.commands.placeholder')}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlighted(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlighted((current) => Math.min(current + 1, entries.length - 1))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlighted((current) => Math.max(current - 1, 0))
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                runEntry(entries[highlighted])
                return
              }
              if (event.key === 'Escape') close()
            }}
          />
        </DialogHeader>
        <ul className="max-h-80 overflow-y-auto p-1">
          {entries.map((entry, index) => (
            <li key={entry.command.id}>
              <button
                type="button"
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => runEntry(entry)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                  index === highlighted ? 'bg-accent text-accent-foreground' : 'text-foreground'
                }`}
              >
                <span className="truncate">{entry.label}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {t(`shell.commands.group.${entry.command.group}`)}
                </span>
              </button>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t('shell.commands.empty')}
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
