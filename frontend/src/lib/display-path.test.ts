import { describe, it, expect } from 'vitest'
import { getRepoRelativeDisplayPath, toDisplayPath, toDisplayPathFrom, resolveAgainstRoot } from './display-path'

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

describe('resolveAgainstRoot', () => {
  it('joins the way the filesystem would', () => {
    const root = '/workspace/users/aasim/workspace'
    expect(resolveAgainstRoot(root, '')).toBe(root)
    expect(resolveAgainstRoot(root, 'repos/RelayAB')).toBe(`${root}/repos/RelayAB`)
    expect(resolveAgainstRoot(root, '..')).toBe('/workspace/users/aasim')
    // The shape the browser really produces once the user walks up and back in.
    expect(resolveAgainstRoot(root, '../setting/assistant')).toBe('/workspace/users/aasim/setting/assistant')
  })

  it('ignores . and duplicate slashes', () => {
    expect(resolveAgainstRoot('/a/b', './x/./y')).toBe('/a/b/x/y')
    expect(resolveAgainstRoot('/a/b', '//x//y')).toBe('/a/b/x/y')
  })
})

describe('toDisplayPath', () => {
  it('shortens a user workspace to /workspace/', () => {
    expect(toDisplayPath('/workspace/users/aasim/workspace')).toBe('/workspace/')
    expect(toDisplayPath('/workspace/users/aasim/workspace/repos/RelayAB')).toBe('/workspace/repos/RelayAB')
  })

  it('shortens the assistant directory to /assistant/', () => {
    expect(toDisplayPath('/workspace/users/aasim/setting/assistant')).toBe('/assistant/')
    expect(toDisplayPath('/workspace/users/aasim/setting/assistant/.opencode/agents')).toBe('/assistant/.opencode/agents')
  })

  it("marks the admin's own root as a root too", () => {
    // The admin's browse root IS the base, so it never matches the
    // `users/<name>/` pattern and would otherwise come out as a bare
    // `/workspace` with nothing to tell it apart from a child path.
    expect(toDisplayPath('/workspace')).toBe('/workspace/')
    expect(toDisplayPath('/workspace/repos/RelayAB')).toBe('/workspace/repos/RelayAB')
  })

  it('gives an admin and a normal user the same spelling of the same place', () => {
    expect(toDisplayPath('/workspace/repos/RelayAB')).toBe(
      toDisplayPath('/workspace/users/aasim/workspace/repos/RelayAB'),
    )
    expect(toDisplayPath('/workspace')).toBe(
      toDisplayPath('/workspace/users/aasim/workspace'),
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
    expect(toDisplayPath('/src')).toBe('/src')
    expect(toDisplayPath('/')).toBe('/')
    expect(toDisplayPath('')).toBe('/')
  })

  it('leaves paths outside both roots untouched', () => {
    expect(toDisplayPath('/workspace/users/aasim/setting/other')).toBe('/workspace/users/aasim/setting/other')
  })
})

describe('toDisplayPathFrom', () => {
  // The browser does not hold an absolute path. It holds `currentPath`,
  // which starts empty and grows by `name` and `..`. Mapping that on its own
  // is what shipped first, and it matched nothing: `src` says nothing about
  // what it is relative to, so the header looked exactly as it always had.
  const userRoot = '/workspace/users/aasim/workspace'

  it('shows the workspace root as /workspace/', () => {
    expect(toDisplayPathFrom(userRoot, '')).toBe('/workspace/')
  })

  it('shows paths inside the workspace under /workspace/', () => {
    expect(toDisplayPathFrom(userRoot, 'repos/RelayAB')).toBe('/workspace/repos/RelayAB')
    expect(toDisplayPathFrom(userRoot, 'repos/RelayAB/src')).toBe('/workspace/repos/RelayAB/src')
  })

  it('shows the assistant directory as /assistant/ once the user walks up to it', () => {
    expect(toDisplayPathFrom(userRoot, '../setting/assistant')).toBe('/assistant/')
    expect(toDisplayPathFrom(userRoot, '../setting/assistant/.opencode')).toBe('/assistant/.opencode')
  })

  it("gives the admin the same header as a normal user", () => {
    expect(toDisplayPathFrom('/workspace', 'repos/RelayAB')).toBe('/workspace/repos/RelayAB')
    expect(toDisplayPathFrom('/workspace', '')).toBe('/workspace/')
  })

  it('shows the raw path when there is no root to resolve against', () => {
    // The listing never arrived, so there is nothing real to shorten. Saying
    // `/workspace/` here would be a confident wrong answer, not a safe one.
    expect(toDisplayPathFrom(undefined, 'src')).toBe('/src')
  })
})
