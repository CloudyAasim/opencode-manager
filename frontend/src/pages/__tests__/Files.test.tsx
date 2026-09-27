import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Files } from '../Files'
import type { FileInfo } from '@/types/files'

vi.mock('@/components/file-browser/FileTreeExplorer', () => ({
  FileTreeExplorer: ({ onSelectFile }: { onSelectFile: (file: FileInfo) => void }) => (
    <button
      type="button"
      onClick={() => onSelectFile({ name: 'a.txt', path: 'a.txt', isDirectory: false, size: 1, lastModified: new Date(0) })}
    >
      pick-file
    </button>
  ),
}))

vi.mock('@/components/file-browser/FilePreview', () => ({
  FilePreview: ({ file }: { file: FileInfo }) => <div data-testid="preview">{file.path}</div>,
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Files page', () => {
  it('renders the tree and asks for a selection before previewing', () => {
    render(<Files />, { wrapper })

    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('pick-file')).toBeInTheDocument()
    expect(screen.queryByTestId('preview')).not.toBeInTheDocument()
  })

  it('previews the file picked from the tree', () => {
    render(<Files />, { wrapper })

    fireEvent.click(screen.getByText('pick-file'))

    expect(screen.getByTestId('preview')).toHaveTextContent('a.txt')
  })
})
