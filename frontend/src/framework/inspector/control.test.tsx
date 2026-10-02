import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { InspectorProvider } from '@/framework/inspector/InspectorProvider'
import { useInspectorControl, type InspectorControlValue } from '@/framework/inspector/control'
import { useRegisterInspectorTab } from '@/framework/inspector/registry'
import type { InspectorTabDefinition } from '@/framework/inspector/registry'
import { CommandProvider } from '@/framework/commands/CommandProvider'
import { LayerProvider } from '@/framework/layer/LayerProvider'
import { useCommandList } from '@/framework/commands/commandRegistry'
import { InspectorCommands } from '@/framework/commands/InspectorCommands'
import { STORAGE_KEYS } from '@/lib/storage-keys'

const TABS: Record<string, InspectorTabDefinition> = {
  files: { id: 'files', labelKey: 'misc.files.title', icon: () => null, render: () => <div>files</div> },
  terminal: { id: 'terminal', labelKey: 'misc.terminal.title', icon: () => null, render: () => <div>terminal</div> },
  'source-control': {
    id: 'source-control',
    labelKey: 'misc.sourceControl.title',
    icon: () => null,
    render: () => <div>source-control</div>,
  },
}

function TabRegistrar({ id }: { id: string }) {
  const definition = TABS[id]
  if (!definition) throw new Error(`unknown tab ${id}`)
  useRegisterInspectorTab(definition)
  return null
}

let control: InspectorControlValue | null = null

function ControlProbe() {
  control = useInspectorControl()
  return null
}

let registered: ReturnType<typeof useCommandList> = []

function CommandProbe() {
  registered = useCommandList()
  return <div data-testid="command-ids">{registered.map((entry) => entry.id).join(',')}</div>
}

function renderInspector(children: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <InspectorProvider>{children}</InspectorProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  control = null
  registered = []
})

describe('inspector control surface', () => {
  it('starts closed and reports the first registered tab as active', () => {
    renderInspector(
      <>
        <TabRegistrar id="files" />
        <ControlProbe />
      </>,
    )

    expect(control?.isOpen).toBe(false)
    expect(control?.tabs.map((entry) => entry.id)).toEqual(['files'])
    expect(control?.activeTab).toBe('files')
  })

  it('opens and closes from outside the panel', () => {
    renderInspector(
      <>
        <TabRegistrar id="files" />
        <ControlProbe />
      </>,
    )

    act(() => control?.open())
    expect(control?.isOpen).toBe(true)

    act(() => control?.close())
    expect(control?.isOpen).toBe(false)
  })

  it('remembers the active tab across a remount', () => {
    const first = renderInspector(
      <>
        <TabRegistrar id="files" />
        <TabRegistrar id="terminal" />
        <ControlProbe />
      </>,
    )
    act(() => control?.selectTab('terminal'))
    expect(control?.activeTab).toBe('terminal')
    first.unmount()

    renderInspector(
      <>
        <TabRegistrar id="files" />
        <TabRegistrar id="terminal" />
        <ControlProbe />
      </>,
    )
    expect(control?.activeTab).toBe('terminal')
  })

  it('falls back to the first tab when the remembered one is gone', () => {
    window.localStorage.setItem(STORAGE_KEYS.inspectorTab, 'removed-feature')
    renderInspector(
      <>
        <TabRegistrar id="files" />
        <ControlProbe />
      </>,
    )

    expect(control?.activeTab).toBe('files')
  })

  it('refuses to hand out control outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<ControlProbe />)).toThrow(/InspectorProvider/)
    spy.mockRestore()
  })
})

describe('inspector commands', () => {
  function Harness() {
    return (
      <LayerProvider>
        <CommandProvider>
          <TabRegistrar id="files" />
          <TabRegistrar id="terminal" />
          <InspectorCommands />
          <CommandProbe />
          <ControlProbe />
        </CommandProvider>
      </LayerProvider>
    )
  }

  function registeredIds(): string[] {
    return (screen.getByTestId('command-ids').textContent ?? '').split(',').filter(Boolean)
  }

  it('derives one command per registered tab', async () => {
    renderInspector(<Harness />)
    await waitFor(() => expect(registeredIds()).toContain('view.inspector.terminal'))

    expect(registeredIds()).toEqual(
      expect.arrayContaining(['view.inspector', 'view.inspector.files', 'view.inspector.terminal']),
    )
  })

  it('opens the panel at the tab whose command ran', async () => {
    renderInspector(<Harness />)
    await waitFor(() => expect(registeredIds()).toContain('view.inspector.terminal'))

    const command = registered.find((entry) => entry.id === 'view.inspector.terminal')
    expect(command).toBeDefined()
    expect(control?.isOpen).toBe(false)

    act(() => command?.run())

    expect(control?.isOpen).toBe(true)
    expect(control?.activeTab).toBe('terminal')
  })

  it('labels the toggle with the action it performs', async () => {
    renderInspector(<Harness />)
    await waitFor(() => expect(registeredIds()).toContain('view.inspector'))

    const closed = registered.find((entry) => entry.id === 'view.inspector')
    expect(closed?.labelKey).toBe('shell.inspector.open')

    act(() => closed?.run())
    await waitFor(() => expect(control?.isOpen).toBe(true))

    const opened = registered.find((entry) => entry.id === 'view.inspector')
    expect(opened?.labelKey).toBe('shell.inspector.close')
  })
})
