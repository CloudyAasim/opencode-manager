import { describe, it, expect } from 'vitest'
import { getRepoRelativeDisplayPath, toDisplayPath } from './display-path'

describe('getRepoRelativeDisplayPath', () => {
  it('returns root when current path equals the base path', () => {
    expect(getRepoRelativeDisplayPath('my-repo', 'my-repo')).toBe('/')
  })

  it('returns root for the assistant directory regardless of display-name casing', () => {
    expect(getRepoRelativeDisplayPath('assistant', 'assistant')).toBe('/')
  })

  it('strips the base path prefix for subdirectories', () => {
    expect(getRepoRelativeDisplayPath('assistant/.opencode/skills', 'assistant')).toBe('/.opencode/skills')
    expect(getRepoRelativeDisplayPath('my-repo/src', 'my-repo')).toBe('/src')
  })

  it('handles worktree directories with branch suffixes', () => {
    expect(getRepoRelativeDisplayPath('my-repo-feature', 'my-repo-feature')).toBe('/')
    expect(getRepoRelativeDisplayPath('my-repo-feature/src', 'my-repo-feature')).toBe('/src')
  })

  it('treats "." as the workspace root base', () => {
    expect(getRepoRelativeDisplayPath('.', '.')).toBe('/')
    expect(getRepoRelativeDisplayPath('some-repo', '.')).toBe('/some-repo')
  })

  it('falls back to the full path when outside the base path', () => {
    expect(getRepoRelativeDisplayPath('other-repo/file', 'assistant')).toBe('/other-repo/file')
  })
})

describe('toDisplayPath', () => {
  it('shortens a user workspace to /workspace', () => {
    expect(toDisplayPath('/workspace/users/aasim/workspace')).toBe('/workspace')
    expect(toDisplayPath('/workspace/users/aasim/workspace/repos/RelayAB')).toBe('/workspace/repos/RelayAB')
  })

  it('shortens the assistant directory to /assistant', () => {
    expect(toDisplayPath('/workspace/users/aasim/setting/assistant')).toBe('/assistant')
    expect(toDisplayPath('/workspace/users/aasim/setting/assistant/.opencode/agents')).toBe('/assistant/.opencode/agents')
  })

  it('gives an admin and a normal user the same spelling of the same place', () => {
    // The reason this exists. Before, the header said one thing to the admin
    // and a longer thing to the user, for the same directory.
    expect(toDisplayPath('/workspace/repos/RelayAB')).toBe(
      toDisplayPath('/workspace/users/aasim/workspace/repos/RelayAB'),
    )
  })

  it('leaves the Assistant project alone', () => {
    // `/workspace/repos/assistant` is a repo the user can clone and delete.
    // Showing it as `/assistant` would make it look like the same thing as the
    // assistant's own folder, which is the one thing it is not.
    expect(toDisplayPath('/workspace/repos/assistant')).toBe('/workspace/repos/assistant')
  })

  it('does not rewrite on a substring match', () => {
    // Segment matching, not string replacement: a directory that merely
    // starts with "workspace" is its own directory.
    expect(toDisplayPath('/workspace/users/aasim/workspaceX')).toBe('/workspace/users/aasim/workspaceX')
    expect(toDisplayPath('/opt/workspace/projects')).toBe('/opt/workspace/projects')
    expect(toDisplayPath('/workspace/users/aasim/setting/assistants')).toBe('/workspace/users/aasim/setting/assistants')
    // The account name sits between `users` and `workspace`, so a naive
    // "the segment before it is users" check misses every real path.
    expect(toDisplayPath('/opt/users/aasim/workspace')).toBe('/opt/users/aasim/workspace')
  })

  it('leaves repo-relative paths untouched', () => {
    // Browsing a single repo passes `/src` here, not a real path.
    expect(toDisplayPath('/src')).toBe('/src')
    expect(toDisplayPath('/')).toBe('/')
    expect(toDisplayPath('')).toBe('/')
  })

  it('leaves paths outside both roots untouched', () => {
    expect(toDisplayPath('/workspace/users/aasim/setting/other')).toBe('/workspace/users/aasim/setting/other')
  })
})
