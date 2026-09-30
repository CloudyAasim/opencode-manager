import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRef, useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FileTree } from './FileTree'
import type { FileInfo } from '@/types/files'

function makeFiles(count: number, childrenPerDir = 0): FileInfo[] {
  return Array.from({ length: count }, (_, index) => {
    const name = `item-${String(index).padStart(4, '0')}`
    const path = `item-${String(index).padStart(4, '0')}`
    if (childrenPerDir > 0) {
      return {
        name,
        path,
        isDirectory: true,
        size: 0,
        lastModified: new Date(0),
        children: Array.from({ length: childrenPerDir }, (_, child) => ({
          name: `child-${child}.ts`,
          path: `${path}/child-${child}.ts`,
          isDirectory: false,
          size: 10,
          lastModified: new Date(0),
        })),
      }
    }
    return { name: `${name}.ts`, path: `${name}.ts`, isDirectory: false, size: 10, lastModified: new Date(0) }
  })
}

function makeScrollRef() {
  const ref = createRef<HTMLDivElement>()
  const node = {
    clientHeight: 500,
    scrollTop: 0,
    scrollHeight: 500,
    getBoundingClientRect: () => ({ top: 0, bottom: 500, height: 500, width: 360 }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLDivElement
  ;(ref as unknown as { current: HTMLDivElement | null }).current = node
  return ref
}

function StatefulTree(props: { files: FileInfo[]; onFileSelect?: (file: FileInfo) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  return (
    <FileTree
      files={props.files}
      onFileSelect={props.onFileSelect}
      scrollRef={makeScrollRef()}
      expandedPaths={expanded}
      onToggleDirectory={(path) =>
        setExpanded((current) => {
          const next = new Set(current)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
      }
    />
  )
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

describe('FileTree', () => {
  it('renders every row for a small tree', () => {
    const files = makeFiles(10)
    render(<StatefulTree files={files} />)

    for (const file of files) {
      expect(screen.getByText(file.name)).toBeInTheDocument()
    }
  })

  it('never renders more rows than the tree contains', () => {
    const files = makeFiles(600)
    const { container } = render(<StatefulTree files={files} />)

    const rows = container.querySelectorAll('[data-tree-row]')
    expect(rows.length).toBeLessThanOrEqual(files.length)
  })

  it('keeps the tree shape: expanding a directory reveals its children', () => {
    const files = makeFiles(3, 2)
    render(<StatefulTree files={files} />)

    expect(screen.queryByText('child-0.ts')).not.toBeInTheDocument()

    act(() => {
      fireEvent.click(document.querySelector('[data-tree-toggle="item-0000"]') as Element)
    })

    expect(screen.getByText('child-0.ts')).toBeInTheDocument()
    expect(screen.getByText('child-1.ts')).toBeInTheDocument()
  })

  it('collapses again on a second toggle', () => {
    const files = makeFiles(2, 2)
    render(<StatefulTree files={files} />)

    const toggle = document.querySelector('[data-tree-toggle="item-0000"]') as Element
    act(() => {
      fireEvent.click(toggle)
    })
    expect(screen.getByText('child-0.ts')).toBeInTheDocument()

    act(() => {
      fireEvent.click(document.querySelector('[data-tree-toggle="item-0000"]') as Element)
    })
    expect(screen.queryByText('child-0.ts')).not.toBeInTheDocument()
  })

  it('selects a file when its row is clicked', () => {
    const onFileSelect = vi.fn()
    const files = makeFiles(3)
    render(<StatefulTree files={files} onFileSelect={onFileSelect} />)

    act(() => {
      fireEvent.click(screen.getByText(files[1]!.name))
    })

    expect(onFileSelect).toHaveBeenCalledWith(files[1])
  })

  it('keeps nested expansion state when the parent is toggled twice', () => {
    const files = makeFiles(1, 3)
    render(<StatefulTree files={files} />)

    const toggle = () => document.querySelector('[data-tree-toggle="item-0000"]') as Element
    act(() => {
      fireEvent.click(toggle())
    })
    expect(screen.getByText('child-0.ts')).toBeInTheDocument()

    act(() => {
      fireEvent.click(toggle())
    })
    expect(screen.queryByText('child-0.ts')).not.toBeInTheDocument()
  })
})
