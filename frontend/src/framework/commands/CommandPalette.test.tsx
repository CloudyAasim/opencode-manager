import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandProvider } from '@/framework/commands/CommandProvider'
import { CommandPalette } from '@/framework/commands/CommandPalette'
import { useRegisterCommands } from '@/framework/commands/commandRegistry'
import { LayerProvider } from '@/framework/layer/LayerProvider'
import type { AppCommand } from '@/framework/commands/types'

function Harness({ commands }: { commands: AppCommand[] }) {
  useRegisterCommands(commands)
  return null
}

function tree(commands: AppCommand[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <LayerProvider>
          <CommandProvider>
            <Harness commands={commands} />
            <CommandPalette />
          </CommandProvider>
        </LayerProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function renderPalette(commands: AppCommand[]) {
  return render(tree(commands))
}

function openPalette() {
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
  return screen.findByRole('textbox')
}

function optionLabels(): string[] {
  return [...document.querySelectorAll('ul li button')].map((node) => node.textContent ?? '')
}

const FILES: AppCommand = {
  id: 'nav.files',
  group: 'navigate',
  labelKey: 'navigation.files',
  label: 'Browse files',
  run: () => undefined,
}

describe('command palette', () => {
  it('Cmd+K opens it and lists the registered commands', async () => {
    renderPalette([FILES])

    expect(screen.queryByRole('textbox')).toBeNull()

    const input = await openPalette()

    expect(input).not.toBeNull()
    expect(optionLabels().some((label) => label.includes('Browse files'))).toBe(true)
  })

  it('Ctrl+K opens it too', async () => {
    renderPalette([FILES])

    fireEvent.keyDown(window, { key: 'K', ctrlKey: true })

    expect(await screen.findByRole('textbox')).not.toBeNull()
  })

  it('a bare k does nothing', () => {
    renderPalette([FILES])

    fireEvent.keyDown(window, { key: 'k' })

    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('running a command closes the palette', async () => {
    const run = vi.fn()
    renderPalette([{ ...FILES, run }])

    await openPalette()
    fireEvent.click(screen.getByText('Browse files'))

    expect(run).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  })

  it('filters by label and by keyword', async () => {
    renderPalette([
      FILES,
      { id: 'b', group: 'navigate', labelKey: 'navigation.schedules', label: 'Open schedules', keywords: ['cron'] },
    ])

    const input = await openPalette()

    fireEvent.change(input, { target: { value: 'cron' } })
    const labels = optionLabels()
    expect(labels.some((label) => label.includes('Open schedules'))).toBe(true)
    expect(labels.some((label) => label.includes('Browse files'))).toBe(false)

    fireEvent.change(input, { target: { value: 'browse' } })
    const narrowed = optionLabels()
    expect(narrowed.some((label) => label.includes('Browse files'))).toBe(true)
    expect(narrowed.some((label) => label.includes('Open schedules'))).toBe(false)
  })

  it('an exact match outranks a prefix match', async () => {
    renderPalette([
      { id: 'a', group: 'navigate', labelKey: 'k.a', label: 'Files', run: () => undefined },
      { id: 'b', group: 'navigate', labelKey: 'k.b', label: 'Files browser', run: () => undefined },
    ])

    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'files' } })

    expect(optionLabels()[0]).toContain('Files')
  })

  it('leaves nothing to run when nothing matches', async () => {
    renderPalette([FILES])

    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'zzzz' } })

    expect(optionLabels()).toEqual([])
  })

  it('unregisters when the owner unmounts', async () => {
    const { rerender } = renderPalette([FILES])

    await openPalette()
    expect(optionLabels().length).toBeGreaterThan(0)

    rerender(tree([]))

    await waitFor(() => expect(optionLabels()).toEqual([]))
  })
})
