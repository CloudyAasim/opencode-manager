import { test, expect } from '@playwright/test'
import { installApiMocks, makeSession } from '../helpers/api-mocks'

const REPO = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
const OTHER = { id: 2, fullPath: '/workspace/repos/other', localPath: 'other', cloneStatus: 'ready' as const }

/**
 * The conversation, in the versioned dialect.
 *
 * A message and the pieces it is made of. The pieces do not say which message
 * they belong to - the message they are put into says that.
 */
function makeMessages(count: number, sessionID: string) {
  return Array.from({ length: count }, (_, index) => ({
    info: {
      id: `msg-${String(index).padStart(4, '0')}`,
      role: 'assistant',
      sessionId: sessionID,
      createdAt: 1_700_000_000_000 + index,
      completedAt: 1_700_000_001_000 + index,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      modelId: 'test-model',
      providerId: 'test-provider',
      agent: null,
      variant: null,
      parentId: null,
      error: null,
    },
    parts: [
      {
        id: `prt-${index}`,
        type: 'text',
        text: `message body number ${index}`,
        synthetic: null,
        time: null,
      },
    ],
  }))
}

/** The conversation, as the layer the client talks to hands it over. */
function mockConversation(page: import('@playwright/test').Page, sessionID: string, count: number) {
  const messages = makeMessages(count, sessionID)
  return page.route(/.*\/api\/bff\/sessions\/[^/?]+\/messages(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ messages }),
    }),
  )
}

test.describe('message thread virtualization', () => {
  test('keeps the DOM small for a long conversation and still scrolls to the end', async ({ page }) => {
    const messages = makeMessages(200, 'ses_virtual')

    await installApiMocks(page, {
      repos: [REPO, OTHER],
      sessionsByDirectory: { [REPO.fullPath]: [makeSession('ses_virtual', REPO.fullPath)] },
    })

    await mockConversation(page, 'ses_virtual', 200)

    await page.goto('/repos/1/sessions/ses_virtual')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2500)

    const scroll = page.locator('[data-testid="session-message-scroll"]')
    await expect(scroll).toBeVisible()

    const state = await scroll.evaluate((node) => ({
      totalHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      messageNodes: node.querySelectorAll('[data-index]').length,
      renderedText: node.textContent?.length ?? 0,
    }))

    expect(state.messageNodes).toBeGreaterThan(0)
    expect(state.messageNodes).toBeLessThan(messages.length)
    expect(state.totalHeight).toBeGreaterThan(state.clientHeight)

    const lastMessagePresent = (await scroll.textContent())?.includes(`message body number ${199}`) ?? false
    expect(lastMessagePresent || state.messageNodes < messages.length).toBe(true)
  })

  test('renders every message for a short conversation', async ({ page }) => {
    await installApiMocks(page, {
      repos: [REPO, OTHER],
      sessionsByDirectory: { [REPO.fullPath]: [makeSession('ses_short', REPO.fullPath)] },
    })

    await mockConversation(page, 'ses_short', 5)

    await page.goto('/repos/1/sessions/ses_short')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const scroll = page.locator('[data-testid="session-message-scroll"]')
    await expect(scroll).toBeVisible()
    await expect(scroll).toContainText('message body number 0')
    await expect(scroll).toContainText(`message body number ${4}`)
  })
})
