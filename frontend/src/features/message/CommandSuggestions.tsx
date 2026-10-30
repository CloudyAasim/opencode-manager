import { useEffect, useRef } from 'react'
import { Command } from 'lucide-react'
import type { components } from '@/api/opencode-types'
import { useTouchTapSelect } from '@/hooks/useTouchTapSelect'
import { Row } from '@/components/ui/row'

type CommandType = components['schemas']['Command']

interface CommandSuggestionsProps {
  isOpen: boolean
  query: string
  commands: CommandType[]
  onSelect: (command: CommandType) => void
  onClose: () => void
  selectedIndex?: number
}

export function CommandSuggestions({
  isOpen,
  query,
  commands,
  onSelect,
  onClose,
  selectedIndex = 0
}: CommandSuggestionsProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const touchTapSelect = useTouchTapSelect(onSelect)

  const filteredCommands = commands.filter(command =>
    command.name.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen || !listRef.current) return

    const selectedItem = listRef.current.children[selectedIndex] as HTMLElement
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, isOpen])

  if (!isOpen || filteredCommands.length === 0) {
    return null
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-2 z-50 bg-surface-glass backdrop-blur-md border border-border rounded-lg shadow-xl max-h-48 md:max-h-[40vh] lg:max-h-[50vh] overflow-y-auto"
    >
      {filteredCommands.map((command, index) => {
        const isSelected = index === selectedIndex
        const displayName = `/${command.name}`

        return (
          <Row
            key={command.name}
            selected={isSelected}
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={touchTapSelect.onTouchStart}
            onTouchMove={touchTapSelect.onTouchMove}
            onTouchEnd={(e) => touchTapSelect.onTouchEnd(e, command)}
            onClick={() => touchTapSelect.onClick(command)}
            className="px-3"
          >
            <Command className={`size-4 flex-shrink-0 ${isSelected ? 'opacity-90' : 'opacity-70'}`} />
            <div className="flex-1 min-w-0">
              <div className="font-mono text-sm font-medium truncate">{displayName}</div>
              {command.description && (
                <div className="text-xs opacity-70 mt-0.5 truncate">{command.description}</div>
              )}
            </div>
          </Row>
        )
      })}
    </div>
  )
}
