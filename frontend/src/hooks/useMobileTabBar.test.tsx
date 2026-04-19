import { renderHook, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { useMobileTabBar, useScheduleTab, type MobileSheetKey } from './useMobileTabBar'

function renderHookWithRouter<T>(renderFn: () => T) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={['/']}>
      {children}
    </MemoryRouter>
  )
  return renderHook(renderFn, { wrapper })
}

describe('useMobileTabBar', () => {
  it('returns null for openSheet when no mobileTab param is present', () => {
    const { result } = renderHookWithRouter(() => useMobileTabBar())
    expect(result.current.openSheet).toBeNull()
  })

  it('returns the correct openSheet when mobileTab param is set', () => {
    const { result } = renderHook(() => useMobileTabBar(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/?mobileTab=repos']}>
          {children}
        </MemoryRouter>
      ),
    })
    expect(result.current.openSheet).toBe('repos')
  })

  it('open sets the mobileTab param', () => {
    const { result } = renderHookWithRouter(() => useMobileTabBar())
    act(() => {
      result.current.open('files')
    })
    expect(result.current.openSheet).toBe('files')
  })

  it('close removes the mobileTab param', () => {
    const { result } = renderHook(() => useMobileTabBar(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/?mobileTab=notifications']}>
          {children}
        </MemoryRouter>
      ),
    })
    expect(result.current.openSheet).toBe('notifications')
    act(() => {
      result.current.close()
    })
    expect(result.current.openSheet).toBeNull()
  })

  it('resolves invalid values to null', () => {
    const { result } = renderHook(() => useMobileTabBar(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/?mobileTab=invalid']}>
          {children}
        </MemoryRouter>
      ),
    })
    expect(result.current.openSheet).toBeNull()
  })

  it('handles all valid MobileSheetKey values', () => {
    const validKeys: MobileSheetKey[] = ['repos', 'files', 'notifications', 'more']
    validKeys.forEach((key) => {
      const { result } = renderHook(() => useMobileTabBar(), {
        wrapper: ({ children }) => (
          <MemoryRouter initialEntries={[`/?mobileTab=${key}`]}>
            {children}
          </MemoryRouter>
        ),
      })
      expect(result.current.openSheet).toBe(key)
    })
  })

  it('returns stable openSheet identity across rerenders when search is unchanged', () => {
    const { result, rerender } = renderHook(() => useMobileTabBar(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/?mobileTab=repos']}>
          {children}
        </MemoryRouter>
      ),
    })
    const firstOpenSheet = result.current.openSheet
    rerender()
    expect(result.current.openSheet).toBe(firstOpenSheet)
  })

  it('open and close callbacks maintain stable identity across rerenders', () => {
    const { result, rerender } = renderHookWithRouter(() => useMobileTabBar())
    const firstOpen = result.current.open
    const firstClose = result.current.close
    rerender()
    expect(result.current.open).toBe(firstOpen)
    expect(result.current.close).toBe(firstClose)
  })

  it('open callback identity is stable across location.search changes', () => {
    const { result, rerender } = renderHook(() => useMobileTabBar(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/?foo=1']}>
          {children}
        </MemoryRouter>
      ),
    })
    const firstOpen = result.current.open
    rerender()
    expect(result.current.open).toBe(firstOpen)
  })
})

describe('useScheduleTab', () => {
  it('defaults to jobs when no param is set', () => {
    const { result } = renderHook(() => useScheduleTab(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/repos/1/schedules']}>{children}</MemoryRouter>
      ),
    })
    expect(result.current.scheduleTab).toBe('jobs')
  })

  it('reads scheduleTab from URL param', () => {
    const { result } = renderHook(() => useScheduleTab(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/repos/1/schedules?scheduleTab=runs']}>{children}</MemoryRouter>
      ),
    })
    expect(result.current.scheduleTab).toBe('runs')
  })

  it('setScheduleTab updates the param', () => {
    const { result } = renderHook(() => useScheduleTab(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/repos/1/schedules']}>{children}</MemoryRouter>
      ),
    })
    act(() => {
      result.current.setScheduleTab('detail')
    })
    expect(result.current.scheduleTab).toBe('detail')
  })

  it('setScheduleTab(jobs) removes the param', () => {
    const { result } = renderHook(() => useScheduleTab(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/repos/1/schedules?scheduleTab=detail']}>{children}</MemoryRouter>
      ),
    })
    expect(result.current.scheduleTab).toBe('detail')
    act(() => {
      result.current.setScheduleTab('jobs')
    })
    expect(result.current.scheduleTab).toBe('jobs')
  })

  it('resolves invalid values to jobs', () => {
    const { result } = renderHook(() => useScheduleTab(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/repos/1/schedules?scheduleTab=invalid']}>{children}</MemoryRouter>
      ),
    })
    expect(result.current.scheduleTab).toBe('jobs')
  })

  it('returns stable scheduleTab identity across rerenders when search is unchanged', () => {
    const { result, rerender } = renderHook(() => useScheduleTab(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/repos/1/schedules?scheduleTab=runs']}>
          {children}
        </MemoryRouter>
      ),
    })
    const firstScheduleTab = result.current.scheduleTab
    rerender()
    expect(result.current.scheduleTab).toBe(firstScheduleTab)
  })

  it('setScheduleTab callback maintains stable identity across rerenders', () => {
    const { result, rerender } = renderHook(() => useScheduleTab(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/repos/1/schedules']}>{children}</MemoryRouter>
      ),
    })
    const firstSetScheduleTab = result.current.setScheduleTab
    rerender()
    expect(result.current.setScheduleTab).toBe(firstSetScheduleTab)
  })
})
