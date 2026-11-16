import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { McpServerCard } from './McpServerCard'
import type { McpServer } from '@/api/mcp'

const serverId = 'my-test-server'

/**
 * The server is the versioned API's shape: what state it is in, and enough of
 * its own shape to draw it. The document it is written down in is the
 * manager's business, and it also holds the credentials of every model
 * provider on the host - so it never travels.
 */
const server: McpServer = {
  name: serverId,
  state: 'connected',
  detail: null,
  kind: 'remote',
  command: null,
  url: 'https://example.com/mcp',
  oauth: null,
}

describe('McpServerCard', () => {
  it('renders display name and description', () => {
    render(
      <McpServerCard
        serverId={serverId}
        server={server}
        errorMessage={null}
        isAnyOperationPending={false}
        togglingServerId={null}
        isRemovingAuth={false}
        onToggleServer={vi.fn()}
        onDeleteServer={vi.fn()}
        onAuthenticate={vi.fn()}
        onRemoveAuth={vi.fn()}
      />,
    )

    expect(screen.getByText('My test server')).toBeInTheDocument()
    expect(screen.getByText('Remote server: https://example.com/mcp')).toBeInTheDocument()
  })

  it('renders the Connected status badge', () => {
    render(
      <McpServerCard
        serverId={serverId}
        server={server}
        errorMessage={null}
        isAnyOperationPending={false}
        togglingServerId={null}
        isRemovingAuth={false}
        onToggleServer={vi.fn()}
        onDeleteServer={vi.fn()}
        onAuthenticate={vi.fn()}
        onRemoveAuth={vi.fn()}
      />,
    )

    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('renders the toggle Switch when not awaiting auth', () => {
    render(
      <McpServerCard
        serverId={serverId}
        server={server}
        errorMessage={null}
        isAnyOperationPending={false}
        togglingServerId={null}
        isRemovingAuth={false}
        onToggleServer={vi.fn()}
        onDeleteServer={vi.fn()}
        onAuthenticate={vi.fn()}
        onRemoveAuth={vi.fn()}
      />,
    )

    const switches = screen.getAllByRole('switch')
    expect(switches.length).toBeGreaterThanOrEqual(1)
  })

  it('calls onDeleteServer when Delete Server is clicked from overflow menu', async () => {
    const user = userEvent.setup()
    const onDeleteServer = vi.fn()

    render(
      <McpServerCard
        serverId={serverId}
        server={server}
        errorMessage={null}
        isAnyOperationPending={false}
        togglingServerId={null}
        isRemovingAuth={false}
        onToggleServer={vi.fn()}
        onDeleteServer={onDeleteServer}
        onAuthenticate={vi.fn()}
        onRemoveAuth={vi.fn()}
      />,
    )

    await user.click(screen.getByLabelText('Actions for My test server'))
    await user.click(screen.getByText('Delete Server'))

    expect(onDeleteServer).toHaveBeenCalledTimes(1)
    expect(onDeleteServer).toHaveBeenCalledWith('my-test-server', 'My test server')
  })

  /**
   * A server that is written down but that the agent has not spoken of is
   * one whose state is unknown. Drawing it as "off" would be saying something
   * nobody said.
   */
  it('draws a server nobody has spoken of as unknown', () => {
    render(
      <McpServerCard
        serverId={serverId}
        server={{ ...server, state: 'unknown', url: null }}
        errorMessage={null}
        isAnyOperationPending={false}
        togglingServerId={null}
        isRemovingAuth={false}
        onToggleServer={vi.fn()}
        onDeleteServer={vi.fn()}
        onAuthenticate={vi.fn()}
        onRemoveAuth={vi.fn()}
      />,
    )

    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })
})
