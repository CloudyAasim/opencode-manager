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

  it('给了右侧内容就排成一行，右侧和标题齐平', () => {
    render(
      <SettingsPanel title="Speech" actions={<span>saved</span>}>
        <p>body</p>
      </SettingsPanel>,
    )

    const header = screen.getByText('Speech').parentElement?.parentElement
    expect(header?.className).toContain('flex items-start justify-between')
    expect(screen.getByText('saved')).toBeInTheDocument()
  })

  it('有说明时，说明在标题下面 4px', () => {
    render(
      <SettingsPanel title="Git" description="克隆与凭据">
        <p>body</p>
      </SettingsPanel>,
    )

    const heading = screen.getByText('Git')
    const description = screen.getByText('克隆与凭据')
    expect(description.className).toContain('mt-1 text-sm text-muted-foreground')
    expect(heading.parentElement).toBe(description.parentElement)
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
