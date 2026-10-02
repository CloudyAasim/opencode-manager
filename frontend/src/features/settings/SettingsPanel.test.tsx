import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsPanel } from './SettingsPanel'

describe('SettingsPanel', () => {
  it('卡片带边框和内边距，标题在最上面', () => {
    render(
      <SettingsPanel title="Notifications">
        <p>body</p>
      </SettingsPanel>,
    )

    const card = screen.getByText('body').parentElement
    expect(card?.className).toContain('bg-card')
    expect(card?.className).toContain('rounded-lg p-6')
    const heading = screen.getByText('Notifications')
    expect(heading.tagName).toBe('H2')
    expect(card?.firstElementChild).toBe(heading)
  })

  it('给了右侧内容就排成一行', () => {
    render(
      <SettingsPanel title="Speech" actions={<span>saved</span>}>
        <p>body</p>
      </SettingsPanel>,
    )

    const header = screen.getByText('Speech').parentElement
    expect(header?.className).toContain('flex items-center justify-between')
    expect(screen.getByText('saved')).toBeInTheDocument()
  })

  it('没给右侧内容时标题直接贴在卡片上，不套 flex 行', () => {
    render(
      <SettingsPanel title="Shortcuts">
        <p>body</p>
      </SettingsPanel>,
    )

    const heading = screen.getByText('Shortcuts')
    const card = screen.getByText('body').parentElement
    expect(card?.firstElementChild).toBe(heading)
    expect(heading.className).not.toContain('flex')
  })
})
