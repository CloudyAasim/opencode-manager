import { describe, it, expect } from 'vitest'
import { projectSessionPath } from './project-session-path'

describe('projectSessionPath', () => {
  it('builds a plain session path for a normal project', () => {
    expect(projectSessionPath(42, 'ses_1')).toBe('/repos/42/sessions/ses_1')
  })

  it('adds the assistant flag for the assistant repository', () => {
    expect(projectSessionPath(0, 'ses_1')).toBe('/repos/0/sessions/ses_1?assistant=1')
  })

  it('prefers the assistant flag over the workspace tab for the assistant', () => {
    expect(projectSessionPath(0, 'ses_1', 'workspaces')).toBe('/repos/0/sessions/ses_1?assistant=1')
  })

  it('adds the workspace tab for a normal project on the workspaces tab', () => {
    expect(projectSessionPath(42, 'ses_1', 'workspaces')).toBe('/repos/42/sessions/ses_1?repoTab=workspaces')
  })
})
