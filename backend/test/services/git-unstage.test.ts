import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitService } from '../../src/services/git/GitService'

const executeCommand = vi.hoisted(() => vi.fn())

vi.mock('../../src/utils/process', () => ({ executeCommand }))
vi.mock('../../src/db/queries', () => ({
  getRepoById: vi.fn(() => ({ id: 1, fullPath: '/repo' })),
}))

function service() {
  return new GitService(
    { getGitEnvironment: () => ({}) } as never,
    {} as never,
    {} as never,
  )
}

beforeEach(() => {
  executeCommand.mockReset()
})

describe('GitService.unstageFiles', () => {
  it('restores from the index when the repository has a commit', async () => {
    executeCommand.mockResolvedValue('')

    await service().unstageFiles(1, ['a.txt'], {} as never)

    const args = executeCommand.mock.calls.at(-1)?.[0] as string[]
    expect(args).toContain('restore')
    expect(args).toContain('--staged')
    expect(args).toContain('a.txt')
  })

  it('falls back to rm --cached when HEAD is unborn (no commits)', async () => {
    executeCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('rev-parse')) throw new Error('fatal: Needed a single revision')
      return ''
    })

    await service().unstageFiles(1, ['a.txt'], {} as never)

    const args = executeCommand.mock.calls.at(-1)?.[0] as string[]
    expect(args).toContain('rm')
    expect(args).toContain('--cached')
    expect(args).toContain('--ignore-unmatch')
    expect(args).not.toContain('restore')
  })

  it('does nothing when no paths are given', async () => {
    executeCommand.mockResolvedValue('')

    const result = await service().unstageFiles(1, [], {} as never)

    expect(result).toBe('')
    expect(executeCommand).not.toHaveBeenCalled()
  })
})
