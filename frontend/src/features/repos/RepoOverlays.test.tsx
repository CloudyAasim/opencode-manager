import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RepoOverlays } from './RepoOverlays'

const { useLayerMock, fileBrowserMock, skillsMock, mcpMock, sourceControlMock } =
  vi.hoisted(() => ({
    useLayerMock: vi.fn(),
    fileBrowserMock: vi.fn(),
    skillsMock: vi.fn(),
    mcpMock: vi.fn(),
    sourceControlMock: vi.fn(),
  }))

vi.mock('@/framework/layer/useLayer', () => ({ useLayer: useLayerMock }))
vi.mock('@/features/file-browser/FileBrowserSheet', () => ({
  FileBrowserSheet: (props: Record<string, unknown>) => {
    fileBrowserMock(props)
    return (
      <button data-testid="file-browser" onClick={() => (props.onClose as () => void)()}>
        files
      </button>
    )
  },
}))
vi.mock('./RepoSkillsDialog', () => ({
  RepoSkillsDialog: (props: Record<string, unknown>) => {
    skillsMock(props)
    return <div data-testid="skills" />
  },
}))
vi.mock('./RepoMcpDialog', () => ({
  RepoMcpDialog: (props: Record<string, unknown>) => {
    mcpMock(props)
    return <div data-testid="mcp" />
  },
}))
vi.mock('@/features/source-control', () => ({
  SourceControlPanel: (props: Record<string, unknown>) => {
    sourceControlMock(props)
    return <div data-testid="source-control" />
  },
}))

const BASE = {
  repoId: 7,
  opcodeUrl: 'http://localhost:5551',
  directory: '/repo',
  basePath: '/repo',
  repoName: 'demo',
  currentBranch: 'main',
}

describe('RepoOverlays', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLayerMock.mockReturnValue([false, vi.fn()])
  })

  // Every one of these has an entry point somewhere; the layer-openers
  // gate is what keeps that true. See test/architecture/layer-openers.
  it('这四个弹层自己从 layer 读开关，不靠页面把 open 传进来', () => {
    render(<RepoOverlays {...BASE} />)

    expect(useLayerMock.mock.calls.map((call) => call[0])).toEqual([
      'files',
      'skills',
      'mcp',
      'sourceControl',
    ])
    expect(fileBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({ isOpen: false, repoId: 7, basePath: '/repo' }),
    )
  })

  it('layer 打开时，弹层拿到的就是打开态', () => {
    useLayerMock.mockImplementation((name: string) => [name === 'mcp', vi.fn()])
    render(<RepoOverlays {...BASE} />)

    expect(mcpMock).toHaveBeenCalledWith(expect.objectContaining({ open: true }))
    expect(skillsMock).toHaveBeenCalledWith(expect.objectContaining({ open: false }))
  })

  it('没有 directory 时不挂 MCP', () => {
    render(<RepoOverlays {...BASE} directory={undefined} />)

    expect(screen.queryByTestId('mcp')).toBeNull()
    expect(screen.getByTestId('skills')).toBeInTheDocument()
  })

  it('有 sessionId 时技能弹层带会话上下文', () => {
    render(<RepoOverlays {...BASE} sessionId="ses_1" />)

    expect(skillsMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'ses_1', opcodeUrl: BASE.opcodeUrl, directory: '/repo' }),
    )
  })

  it('没有 sessionId 时技能弹层不带会话上下文', () => {
    render(<RepoOverlays {...BASE} />)

    const props = skillsMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(props.sessionId).toBeUndefined()
    expect(props.opcodeUrl).toBeUndefined()
  })

  it('关闭文件浏览器时同时通知页面清掉选中的文件', () => {
    const setOpen = vi.fn()
    useLayerMock.mockImplementation(() => [false, setOpen])
    const onFileBrowserClosed = vi.fn()
    render(<RepoOverlays {...BASE} onFileBrowserClosed={onFileBrowserClosed} />)

    screen.getByTestId('file-browser').click()

    expect(setOpen).toHaveBeenCalledWith(false)
    expect(onFileBrowserClosed).toHaveBeenCalledTimes(1)
  })
})
