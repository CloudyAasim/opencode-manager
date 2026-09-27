import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { Header } from './header'

function LocationSpy() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

describe('Header.Settings', () => {
  it('navigates to the settings view instead of opening an overlay', () => {
    render(
      <MemoryRouter initialEntries={['/repos/0']}>
        <Header>
          <span>title</span>
        </Header>
        <Header.Settings />
        <LocationSpy />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByLabelText('Settings'))

    expect(screen.getByTestId('location').textContent).toBe('/settings')
  })
})
