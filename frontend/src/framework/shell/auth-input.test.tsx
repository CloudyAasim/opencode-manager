import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthInput } from './AuthShell'

describe('AuthInput', () => {
  it('带上认证表单自己的那套样式', () => {
    render(<AuthInput data-testid="field" />)
    const input = screen.getByTestId('field')
    expect(input.className).toContain('bg-input')
    expect(input.className).toContain('border-border')
    expect(input.className).toContain('focus:border-primary')
  })

  it('调用方还能再叠自己的 class', () => {
    render(<AuthInput data-testid="field" className="mt-2" />)
    const input = screen.getByTestId('field')
    expect(input.className).toContain('bg-input')
    expect(input.className).toContain('mt-2')
  })

  it('原生属性照常透传', () => {
    render(<AuthInput type="email" placeholder="you@example.com" required />)
    const input = screen.getByPlaceholderText('you@example.com')
    expect(input).toHaveAttribute('type', 'email')
    expect(input).toBeRequired()
  })
})
