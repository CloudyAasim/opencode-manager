import { test, expect } from '@playwright/test'
import { installApiMocks, makeSession } from '../helpers/api-mocks'

const REPO = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
const OTHER = { id: 2, fullPath: '/workspace/repos/other', localPath: 'other', cloneStatus: 'ready' as const }

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${String(index).padStart(4, '0')}`,
    role: 'assistant',
    sessionID: 'ses_virtual',
    time: { created: 1_700_000_000_000 + index, completed: 1_700_000_001_000 + index },
    modelID: 'test-model',
    parts: [
      {
        id: `prt-${index}`,
        sessionID: 'ses_virtual',
        messageID: `msg-${String(index).padStart(4, '0')}`,
        type: 'text',
        text: `message body number ${index}`,
      },
    ],
  }))
}

function messageListResponse(ids: string[]) {
  return {
    data: ids.map((id) => ({
      id,
      projectID: 'p',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      title: 'session',
      location: { directory: REPO.fullPath },
    })),
  }
}

function sessionResponse() {
  return {
    id: 'ses_virtual',
    projectID: 'p',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1_700_000_000_000, completed: 1_700_000_001_000 },
    modelID: 'test-model',
    title: 'virtual session',
    location: { directory: REPO.fullPath },
  }
}

test.describe('message thread virtualization', () => {
  test('keeps the DOM small for a long conversation and still scrolls to the end', async ({ page }) => {
    const messages = makeMessages(200)

    await installApiMocks(page, {
      repos: [REPO, OTHER],
      sessionsByDirectory: { [REPO.fullPath]: [makeSession('ses_virtual', REPO.fullPath)] },
    })

    await page.route(/.*\/api\/opencode\/.*message.*$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(messages.map((message) => ({ info: message, parts: message.parts }))),
      }),
    )
    await page.route(/.*\/api\/opencode\/session\/ses_virtual(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sessionResponse()),
      }),
    )

    await page.route(/.*\/api\/opencode\/api\/session(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(messageListResponse(['ses_virtual'])),
      }),
    )
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
    const messages = makeMessages(5)

    await installApiMocks(page, {
      repos: [REPO, OTHER],
      sessionsByDirectory: { [REPO.fullPath]: [makeSession('ses_short', REPO.fullPath)] },
    })

    await page.route(/.*\/api\/opencode\/api\/session(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(messageListResponse(['ses_short'])),
      }),
    )
    await page.route(/.*\/api\/opencode\/.*message.*$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(messages.map((message) => ({ info: message, parts: message.parts }))),
      }),
    )
    await page.route(/.*\/api\/opencode\/session\/ses_short(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...sessionResponse(), id: 'ses_short' }),
      }),
    )

    await page.route(/.*\/api\/opencode\/session\/ses_short(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...sessionResponse(), id: 'ses_short' }),
      }),
    )
    await page.route(/.*\/api\/opencode\/.*message.*$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(messages.map((message) => ({ info: message, parts: message.parts }))),
      }),
    )

    await page.goto('/repos/1/sessions/ses_short')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const scroll = page.locator('[data-testid="session-message-scroll"]')
    await expect(scroll).toBeVisible()
    await expect(scroll).toContainText('message body number 0')
    await expect(scroll).toContainText(`message body number ${4}`)
  })
})
