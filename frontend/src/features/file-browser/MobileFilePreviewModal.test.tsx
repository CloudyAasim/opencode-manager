import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MobileFilePreviewModal } from './MobileFilePreviewModal'
import type { FileInfo } from '@/types/files'

vi.mock('./FilePreview', () => ({
  FilePreview: ({ onCloseModal }: { onCloseModal?: () => void }) => (
    <button type="button" onClick={() => onCloseModal?.()}>
      close the preview
    </button>
  ),
}))

const FILE: FileInfo = {
  name: 'notes.txt',
  path: '/repo/notes.txt',
  isDirectory: false,
  size: 12,
  lastModified: new Date(0),
}

describe('MobileFilePreviewModal', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('the close timer does not outlive it', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const { unmount } = render(
      <MobileFilePreviewModal isOpen file={FILE} onClose={onClose} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'close the preview' }))
    expect(vi.getTimerCount(), 'the close was given a moment to settle').toBeGreaterThan(0)

    unmount()
    expect(vi.getTimerCount(), 'the timer outlived the modal').toBe(0)
  })
})
