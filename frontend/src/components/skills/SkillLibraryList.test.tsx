import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { SkillFileInfo } from '@opencode-manager/shared'
import { SkillLibraryList } from './SkillLibraryList'

const SKILLS: SkillFileInfo[] = [
  { name: 'teach', scope: 'project', description: 'explains things', location: '/x/teach', repoName: 'demo' },
  { name: 'audit', scope: 'global', description: 'checks things', location: '/y/audit' },
]

const renderList = (data: unknown) =>
  render(
    <SkillLibraryList
      isLoading={false}
      data={data as SkillFileInfo[] | undefined}
      error={null}
      emptyTitle="No skills yet"
      emptyHint="Install one to see it here"
    />,
  )

describe('SkillLibraryList', () => {
  it('lists the skills it is handed', () => {
    renderList(SKILLS)

    expect(screen.getByText('teach')).toBeInTheDocument()
    expect(screen.getByText('audit')).toBeInTheDocument()
  })

  /**
   * `data ?? []` was the only guard between this component and a `.filter`.
   * It catches null and undefined and nothing else, so an object from the API
   * went straight through and the first `.filter` on it threw
   * `data.filter is not a function`, which the route's error boundary turned
   * into a full-page "Error" with a Try again button that failed the same way.
   *
   * React surfaces a throw during render as an unhandled error, so "does not
   * throw" is the assertion; the empty state is what proves it took the guarded
   * path rather than some other one.
   */
  it.each([
    ['undefined', undefined],
    ['an object', { skills: [] }],
    ['a string', 'teach'],
    ['a number', 3],
    ['null', null],
  ])('renders the empty state instead of crashing on %s', (_label, data) => {
    expect(() => renderList(data)).not.toThrow()
    expect(screen.getByText('No skills yet')).toBeInTheDocument()
  })

  it('counts by scope rather than counting whatever arrived', () => {
    renderList(SKILLS)

    // Three filter buttons, each labelled with its tally. The accessible name
    // is the label and the number run together ("All2"), so this asks for the
    // button by label and reads the whole thing back rather than trying to
    // match the digits alone.
    const tabs = [
      [/^all/i, '2'],
      [/^project/i, '1'],
      [/^global/i, '1'],
    ] as const

    for (const [label, count] of tabs) {
      expect(screen.getByRole('button', { name: label })).toHaveTextContent(count)
    }
  })
})
