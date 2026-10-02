import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { currentLocale, useI18n } from '@/lib/i18n'
import { createOpenCodeClient } from '@/api/opencode'
import type { components } from '@/api/opencode-types'

type CommandType = components['schemas']['Command']

function sortCommandsByName(commands: CommandType[]): CommandType[] {
  return [...commands].sort((a, b) => a.name.localeCompare(b.name))
}

function rankCommandMatch(command: CommandType, searchTerm: string): number {
  const name = command.name.toLowerCase()
  if (name === searchTerm) return 0
  if (name.startsWith(searchTerm)) return 1
  return 2
}

/** The command palette renders these descriptions, so they are part of the
 *  UI and not metadata - which is why they go through t() like any other
 *  string the user reads. */
function builtinCommands(t: (key: string) => string): CommandType[] {
  const B = (name: string) => t(`shell.commands.builtin.${name}`)
  return [
  {
    name: 'help',
    description: B('help'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'init',
    description: B('init'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'new',
    description: B('new'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'clear',
    description: B('newAlias'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'sessions',
    description: B('sessions'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'resume',
    description: B('sessionsAlias'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'continue',
    description: B('sessionsAlias2'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'models',
    description: B('models'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'themes',
    description: B('themes'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'share',
    description: B('share'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'unshare',
    description: B('unshare'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'export',
    description: B('export'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'compact',
    description: B('compact'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'summarize',
    description: B('compactAlias'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'undo',
    description: B('undo'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'redo',
    description: B('redo'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'details',
    description: B('details'),
    template: '',
    agent: '',
    model: '',
    hints: []
  },
  {
    name: 'editor',
    description: B('editor'),
    template: '',
    agent: '',
    model: '',
    hints: []
  }
  ]
}

export function useCommands(opcodeUrl: string | null) {
  const { t } = useI18n()
  const locale = currentLocale()
  // `t` changes identity when the language does, so the list follows. What
  // actually decides what gets cached is the query key below, which carries
  // the locale explicitly - and a gate asserts that it does.
  const builtins = useMemo(() => builtinCommands(t), [t])
  const sortedBuiltins = useMemo(() => sortCommandsByName(builtins), [builtins])
  const { data: commands, isLoading: loading, error } = useQuery({
    // locale is part of the key: these descriptions are translated, so a
    // cached list from the previous language would be rendered as-is
    queryKey: ['opencode', 'commands', opcodeUrl, locale],
    queryFn: async () => {
      const client = createOpenCodeClient(opcodeUrl!)
      const commandList = await client.listCommands()
      const allCommands = [...builtins, ...commandList]
      const uniqueCommands = allCommands.filter((command, index, self) =>
        index === self.findIndex((c) => c.name === command.name)
      )
      return sortCommandsByName(uniqueCommands)
    },
    enabled: !!opcodeUrl,
    initialData: sortedBuiltins,
  })

  const filterCommands = (query: string) => {
    if (!query.trim()) return commands
    
    const searchTerm = query.toLowerCase()
    return commands
      .filter(command => command.name.toLowerCase().includes(searchTerm))
      .sort((a, b) => {
        const rankDifference = rankCommandMatch(a, searchTerm) - rankCommandMatch(b, searchTerm)
        if (rankDifference !== 0) return rankDifference
        return a.name.localeCompare(b.name)
      })
  }

  return {
    commands,
    loading,
    error: error ? t('shell.commands.loadFailed') : null,
    filterCommands
  }
}
