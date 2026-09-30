import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRef } from 'react'
import { render } from '@testing-library/react'
import { VirtualMessageList } from './VirtualMessageList'

interface Row {
  id: string
  label: string
}

const ROWS: Row[] = Array.from({ length: 60 }, (_, index) => ({
  id: `row-${index}`,
  label: `row ${index}`,
}))

function makeScrollRef() {
  const ref = createRef<HTMLDivElement>()
  const node = {
    clientHeight: 600,
    scrollTop: 0,
    scrollHeight: 600,
    getBoundingClientRect: () => ({ top: 0, bottom: 600, height: 600, width: 390 }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLDivElement
   
  ;(ref as any).current = node
  return ref
}

describe('VirtualMessageList', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  it('renders every row when virtualization is disabled', () => {
    const { getAllByText } = render(
      <VirtualMessageList
        items={ROWS}
        scrollRef={makeScrollRef()}
        enabled={false}
        estimateSize={() => 120}
        getKey={(row) => row.id}
      >
        {(row) => <div>{row.label}</div>}
      </VirtualMessageList>,
    )

    expect(getAllByText(/^row /)).toHaveLength(ROWS.length)
  })

  it('never renders more rows than it was given', () => {
    const { queryAllByText } = render(
      <VirtualMessageList items={ROWS} scrollRef={makeScrollRef()} enabled estimateSize={() => 120} getKey={(row) => row.id}>
        {(row) => <div>{row.label}</div>}
      </VirtualMessageList>,
    )

    expect(queryAllByText(/^row /).length).toBeLessThanOrEqual(ROWS.length)
  })

  it('passes the item and its index to the render prop', () => {
    const seen: Array<[string, number]> = []
    render(
      <VirtualMessageList
        items={ROWS.slice(0, 3)}
        scrollRef={makeScrollRef()}
        enabled={false}
        estimateSize={() => 120}
        getKey={(row) => row.id}
      >
        {(row, index) => {
          seen.push([row.id, index])
          return <div>{row.label}</div>
        }}
      </VirtualMessageList>,
    )

    expect(seen).toEqual([
      ['row-0', 0],
      ['row-1', 1],
      ['row-2', 2],
    ])
  })
})
