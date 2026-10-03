import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { SessionPanel, type SessionPanelTab } from './SessionPanel'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { DEFAULT_PANEL_TAB_IDS } from '@/pages/SessionDetail'

const TAB = (id: string, label: string): SessionPanelTab => ({
  id,
  labelKey: label,
  icon: () => null,
  render: () => <div>{label}</div>,
})

const TABS: SessionPanelTab[] = [
  TAB('files', 'Files'),
  TAB('terminal', 'Terminal'),
  TAB('review', 'Review'),
  TAB('info', 'Info'),
]

const panel = (tabs: SessionPanelTab[]) => (
  <SessionPanel
    open
    onOpenChange={vi.fn()}
    isDesktop
    width={420}
    onResizeStart={vi.fn()}
    onResizeTouchStart={vi.fn()}
    onResizeKey={vi.fn()}
    tabs={tabs}
    defaultTabIds={DEFAULT_PANEL_TAB_IDS}
    storageKey={STORAGE_KEYS.chatPanelTabs}
  />
)

function renderPanel(tabs: SessionPanelTab[] = TABS) {
  return render(panel(tabs))
}

// The tab strip and the active tab's own content both say "Files", so text
// lookup is ambiguous. The draggable wrappers are the tabs, one each, in order.
const wrappers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('div[draggable="true"]'))

const order = () =>
  wrappers(document.body).map(
    (w) => w.querySelector('button')?.textContent?.trim() ?? '',
  )

const stored = () =>
  JSON.parse(window.localStorage.getItem(STORAGE_KEYS.chatPanelTabs)!)

const drag = (from: number, to: number) => {
  const all = wrappers(document.body)
  const source = all[from]!
  const target = all[to]!
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData() {}, getData() { return '' } }
  fireEvent.dragStart(source, { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  fireEvent.dragEnd(source, { dataTransfer })
}

/**
 * The panel that has files / terminal / source-control / details is the session
 * panel, not the inspector - the drag ordering went on the wrong one first.
 * Its order is persisted, and the stored value is validated against the known
 * ids, so an order from before the change falls back to the new default.
 */
describe('会话右侧面板的标签顺序', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('默认就是 文件、终端、源代码管理、详情', () => {
    renderPanel()
    expect(order()).toEqual(['Files', 'Terminal', 'Review', 'Info'])
  })

  it('可以拖动排序，并记住', () => {
    renderPanel()
    drag(2, 0)

    expect(order()).toEqual(['Review', 'Files', 'Terminal', 'Info'])
    expect(stored()).toEqual(['review', 'files', 'terminal', 'info'])
  })

  it('拖回去也对', () => {
    renderPanel()
    drag(3, 0)
    drag(0, 3)
    expect(order()).toEqual(['Files', 'Terminal', 'Review', 'Info'])
  })

  it('存着一个带陌生 id 的顺序时，回到默认而不是照着它渲染', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.chatPanelTabs,
      JSON.stringify(['review', 'gone-last-century', 'files']),
    )
    renderPanel()
    expect(order()).toEqual(['Files', 'Terminal', 'Review', 'Info'])
  })

  /**
   * The order lives under one key shared by every session, but not every
   * session has the same set of tabs - an assistant conversation has no
   * terminal. Switching to one hides the tab instead of forgetting it, and
   * that is true of every path through this component except one: a reorder
   * used to drop the hidden id on the floor and write that back to storage.
   */
  it('换到一个没有该标签的会话再拖动，不会把它从记录里抹掉', () => {
    const { rerender } = renderPanel()
    drag(2, 0)
    expect(stored()).toEqual(['review', 'files', 'terminal', 'info'])

    rerender(panel(TABS.filter((tab) => tab.id !== 'terminal')))
    expect(order()).toEqual(['Review', 'Files', 'Info'])

    drag(2, 0)

    expect(order()).toEqual(['Info', 'Review', 'Files'])
    expect(stored()).toEqual(['info', 'review', 'files', 'terminal'])
  })
})
