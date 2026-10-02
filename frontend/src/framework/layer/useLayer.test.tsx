import { useEffect, useRef, useState } from 'react'
import { renderHook, act, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { useLayer } from './useLayer'
import { LayerProvider } from '@/framework/layer/LayerProvider'
import { describe, it, expect } from 'vitest'

describe('layer stack', () => {
  const createWrapper = (initialEntries?: string[]) => {
    return function wrapper({ children }: { children: React.ReactNode }) {
      return (
        <MemoryRouter initialEntries={initialEntries}>
          <LayerProvider>{children}</LayerProvider>
        </MemoryRouter>
      )
    }
  }

  it('returns false when dialog param does not match name', () => {
    const wrapper = createWrapper()
    const { result } = renderHook(() => useLayer('mcp'), { wrapper })
    expect(result.current[0]).toBe(false)
  })

  it('returns true when dialog param matches name', () => {
    const wrapper = createWrapper(['/?dialog=mcp'])
    const { result } = renderHook(() => useLayer('mcp'), { wrapper })
    expect(result.current[0]).toBe(true)
  })

  it('opening clears mobileTab', () => {
    const wrapper = createWrapper(['/?mobileTab=more'])
    const { result } = renderHook(() => useLayer('mcp'), { wrapper })

    expect(result.current[0]).toBe(false)

    act(() => {
      result.current[1](true)
    })

    expect(result.current[0]).toBe(true)
  })

  it('closing removes dialog param', () => {
    const wrapper = createWrapper(['/?dialog=mcp&other=value'])
    const { result } = renderHook(() => useLayer('mcp'), { wrapper })

    expect(result.current[0]).toBe(true)

    act(() => {
      result.current[1](false)
    })

    expect(result.current[0]).toBe(false)
  })

  it('isOpen is true only when dialog exactly matches name', () => {
    const wrapper1 = createWrapper(['/?dialog=skills'])
    const { result: result1 } = renderHook(() => useLayer('mcp'), { wrapper: wrapper1 })

    const wrapper2 = createWrapper(['/?dialog=skills'])
    const { result: result2 } = renderHook(() => useLayer('skills'), { wrapper: wrapper2 })

    expect(result1.current[0]).toBe(false)
    expect(result2.current[0]).toBe(true)
  })

  it('concurrent different names do not interfere on first paint', () => {
    const wrapper = createWrapper(['/?dialog=mcp'])
    const { result: result1 } = renderHook(() => useLayer('mcp'), { wrapper })
    const { result: result2 } = renderHook(() => useLayer('skills'), { wrapper })

    expect(result1.current[0]).toBe(true)
    expect(result2.current[0]).toBe(false)
  })

  it('opening a second layer keeps the first one open', () => {
    const wrapper = createWrapper()
    const { result } = renderHook(
      () => ({
        mcp: useLayer('mcp'),
        skills: useLayer('skills'),
      }),
      { wrapper },
    )

    act(() => {
      result.current.mcp[1](true)
    })
    expect(result.current.mcp[0]).toBe(true)

    act(() => {
      result.current.skills[1](true)
    })

    expect(result.current.skills[0]).toBe(true)
    expect(result.current.mcp[0]).toBe(true)
  })

  it('closing a middle layer leaves the top layer alone', () => {
    const wrapper = createWrapper()
    const { result } = renderHook(
      () => ({
        mcp: useLayer('mcp'),
        skills: useLayer('skills'),
      }),
      { wrapper },
    )

    act(() => {
      result.current.mcp[1](true)
    })
    act(() => {
      result.current.skills[1](true)
    })

    act(() => {
      result.current.mcp[1](false)
    })

    expect(result.current.mcp[0]).toBe(false)
    expect(result.current.skills[0]).toBe(true)
  })

  it('opening the same layer twice does not duplicate it', () => {
    const wrapper = createWrapper()
    const { result } = renderHook(
      () => ({
        mcp: useLayer('mcp'),
        skills: useLayer('skills'),
      }),
      { wrapper },
    )

    act(() => {
      result.current.mcp[1](true)
    })
    act(() => {
      result.current.mcp[1](true)
    })

    act(() => {
      result.current.skills[1](true)
    })

    act(() => {
      result.current.mcp[1](false)
    })

    expect(result.current.skills[0]).toBe(true)
  })

  it('open pushes so browser back closes the dialog', () => {
    function DialogPushHarness() {
      const [isOpen, setOpen] = useLayer('mcp')
      const navigate = useNavigate()
      const [step, setStep] = useState<'start' | 'opened' | 'back'>('start')
      const handled = useRef(false)

      useEffect(() => {
        if (handled.current) return
        if (step === 'opened') {
          handled.current = true
          setOpen(true)
        } else if (step === 'back') {
          handled.current = true
          navigate(-1)
        }
      }, [step, setOpen, navigate])

      return (
        <div>
          <span data-testid="dialog-state">{isOpen ? 'open' : 'closed'}</span>
          <button onClick={() => { handled.current = false; setStep('opened') }}>
            open
          </button>
          <button onClick={() => { handled.current = false; setStep('back') }}>
            back
          </button>
        </div>
      )
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <LayerProvider>
          <DialogPushHarness />
        </LayerProvider>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('dialog-state').textContent).toBe('closed')

    act(() => { screen.getByText('open').click() })
    expect(screen.getByTestId('dialog-state').textContent).toBe('open')

    act(() => { screen.getByText('back').click() })
    expect(screen.getByTestId('dialog-state').textContent).toBe('closed')
  })

  it('browser back pops only the top layer and reveals the one beneath', () => {
    function StackHarness() {
      const [mcpOpen] = useLayer('mcp')
      const [skillsOpen, setSkillsOpen] = useLayer('skills')
      const navigate = useNavigate()

      return (
        <div>
          <span data-testid="mcp">{mcpOpen ? 'open' : 'closed'}</span>
          <span data-testid="skills">{skillsOpen ? 'open' : 'closed'}</span>
          <button onClick={() => setSkillsOpen(true)}>open skills</button>
          <button onClick={() => navigate(-1)}>back</button>
        </div>
      )
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <LayerProvider>
          <StackHarness />
        </LayerProvider>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('skills').textContent).toBe('closed')

    act(() => { screen.getByText('open skills').click() })
    expect(screen.getByTestId('skills').textContent).toBe('open')

    act(() => { screen.getByText('back').click() })
    expect(screen.getByTestId('skills').textContent).toBe('closed')
    expect(screen.getByTestId('mcp').textContent).toBe('closed')
  })
})
