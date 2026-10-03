import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  DEFAULT_INSPECTOR_TAB_ORDER,
  orderInspectorTabs,
  useRegisterInspectorTab,
  type InspectorTabDefinition,
} from './registry'
import { InspectorProvider } from './InspectorProvider'
import { useInspectorControl } from './control'
import { STORAGE_KEYS } from '@/lib/storage-keys'

/**
 * The tab order used to be whatever order the tabs happened to register in,
 * which is the order they happen to be written in App.tsx. That is an accident,
 * and a tab added at the top of that file would silently move three others.
 *
 * The order is now decided in one pure function, and the one thing it must not
 * do is throw on a half-known list: a tab that has not shipped yet, a tab that
 * has been removed, and an order the user dragged a year ago all have to
 * degrade rather than break the panel.
 */
describe('检视器标签的顺序', () => {
  it('默认顺序是定的，而且把还没做的详情算在里面', () => {
    expect([...DEFAULT_INSPECTOR_TAB_ORDER]).toEqual([
      'files',
      'terminal',
      'source-control',
      'details',
    ])
  })

  it('没有存过顺序时按默认顺序排', () => {
    expect(orderInspectorTabs(['files', 'terminal', 'source-control'], null)).toEqual([
      'files',
      'terminal',
      'source-control',
    ])
  })

  it('存过的顺序说了算', () => {
    expect(orderInspectorTabs(['files', 'terminal', 'source-control'], 'source-control,files,terminal'))
      .toEqual(['source-control', 'files', 'terminal'])
  })

  it('存过的顺序里有过期的标签就跳过，不报错', () => {
    expect(orderInspectorTabs(['files', 'terminal'], 'files,removed-thing,terminal'))
      .toEqual(['files', 'terminal'])
  })

  it('新加的标签排在后面，不打乱用户已经排好的', () => {
    expect(orderInspectorTabs(['files', 'terminal', 'brand-new'], 'terminal,files'))
      .toEqual(['terminal', 'files', 'brand-new'])
  })

  it('重复和空项都被吃掉', () => {
    expect(orderInspectorTabs(['files', 'terminal'], 'files,,files, terminal '))
      .toEqual(['files', 'terminal'])
  })

  it('一个都没存过又都不在默认里时，按注册顺序来', () => {
    expect(orderInspectorTabs(['zzz', 'aaa'], '')).toEqual(['zzz', 'aaa'])
  })
})

// The real callers pass a module-level constant, and it has to stay that way:
// useRegisterInspectorTab keys its effect on the definition, so a fresh object
// literal every render unregisters and registers in a loop that never settles.
const TAB_FILES: InspectorTabDefinition = {
  id: 'files',
  labelKey: 'navigation.files',
  icon: () => null,
  render: () => null,
}
const TAB_TERMINAL: InspectorTabDefinition = { ...TAB_FILES, id: 'terminal' }
const TAB_SOURCE_CONTROL: InspectorTabDefinition = { ...TAB_FILES, id: 'source-control' }

function TabRegistrar({ tab }: { tab: InspectorTabDefinition }) {
  useRegisterInspectorTab(tab)
  return null
}

function OrderProbe() {
  const { tabs, moveTab } = useInspectorControl()
  return (
    <div>
      <span data-testid="order">{tabs.map((tab) => tab.id).join(',')}</span>
      <button onClick={() => moveTab(0, 1)}>swap</button>
    </div>
  )
}

describe('把标签拖到别的位置', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('拖动之后顺序变了，而且记住了', () => {
    render(
      <InspectorProvider>
        <TabRegistrar tab={TAB_FILES} />
        <TabRegistrar tab={TAB_TERMINAL} />
        <TabRegistrar tab={TAB_SOURCE_CONTROL} />
        <OrderProbe />
      </InspectorProvider>,
    )
    expect(screen.getByTestId('order')).toHaveTextContent('files,terminal,source-control')

    fireEvent.click(screen.getByRole('button', { name: 'swap' }))

    expect(screen.getByTestId('order')).toHaveTextContent('terminal,files,source-control')
    expect(window.localStorage.getItem(STORAGE_KEYS.inspectorTabOrder))
      .toBe('terminal,files,source-control')
  })

  it('下一次打开还记得上次的顺序', () => {
    window.localStorage.setItem(STORAGE_KEYS.inspectorTabOrder, 'source-control,files,terminal')
    render(
      <InspectorProvider>
        <TabRegistrar tab={TAB_FILES} />
        <TabRegistrar tab={TAB_TERMINAL} />
        <TabRegistrar tab={TAB_SOURCE_CONTROL} />
        <OrderProbe />
      </InspectorProvider>,
    )
    expect(screen.getByTestId('order')).toHaveTextContent('source-control,files,terminal')
  })

  it('存过的顺序里有过期标签时，面板照常打开', () => {
    window.localStorage.setItem(STORAGE_KEYS.inspectorTabOrder, 'files,long-gone')
    render(
      <InspectorProvider>
        <TabRegistrar tab={TAB_FILES} />
        <TabRegistrar tab={TAB_TERMINAL} />
        <OrderProbe />
      </InspectorProvider>,
    )
    expect(screen.getByTestId('order')).toHaveTextContent('files,terminal')
  })
})
