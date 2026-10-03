import { describe, it, expect } from 'vitest'
import { toPromptMentionPath } from './prompt-mention-path'

/**
 * This moved out of the mobile drawer when the command and mention entries
 * moved onto the conversation screen itself, so the rules now have to stand on
 * their own rather than being a detail of wherever the entry point happens to
 * live.
 */
describe('提示里引用文件的路径换算', () => {
  it('工作目录已知时，去掉它留下的前缀', () => {
    expect(toPromptMentionPath('repo/src/App.tsx', 'repo')).toBe('src/App.tsx')
  })

  it('前缀相同但不是路径边界时不动它', () => {
    // 'repo-tools' starts with 'repo' but is a different folder entirely.
    expect(toPromptMentionPath('repo-tools/main.ts', 'repo')).toBe('repo-tools/main.ts')
  })

  it('工作目录末尾有斜杠时也算同一个前缀', () => {
    expect(toPromptMentionPath('repo/src/App.tsx', 'repo/')).toBe('src/App.tsx')
  })

  it('路径开头的 ./ 一定被剥掉，与工作目录无关', () => {
    expect(toPromptMentionPath('./repo/src/App.tsx', './repo')).toBe('src/App.tsx')
    expect(toPromptMentionPath('./src/App.tsx', 'repo')).toBe('src/App.tsx')
  })

  it('不在工作目录下的路径原样返回', () => {
    expect(toPromptMentionPath('/etc/hosts', 'repo')).toBe('/etc/hosts')
  })

  it('没有工作目录时原样返回', () => {
    expect(toPromptMentionPath('src/App.tsx', null)).toBe('src/App.tsx')
    expect(toPromptMentionPath('src/App.tsx', undefined)).toBe('src/App.tsx')
    expect(toPromptMentionPath('src/App.tsx', '')).toBe('src/App.tsx')
  })
})
