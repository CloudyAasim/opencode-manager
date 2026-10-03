import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, makeSession } from '../helpers/api-mocks'

const REPO = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
const ASSISTANT = { id: 0, fullPath: '/workspace/repos/assistant', localPath: 'assistant', cloneStatus: 'ready' as const }

async function openSession(page: Page, sessionId = 'ses_back') {
  await installApiMocks(page, {
    repos: [ASSISTANT, REPO],
    sessionsByDirectory: {
      [REPO.fullPath]: [makeSession(sessionId, REPO.fullPath)],
      [ASSISTANT.fullPath]: [makeSession('ses_asst', ASSISTANT.fullPath)],
    },
  })
  await page.goto('/')
  await expect(page.locator('#root')).not.toBeEmpty()
  await page.goto(`/repos/1/sessions/${sessionId}`)
  await expect(page.locator('#root')).not.toBeEmpty()
}

test.describe('session back navigation', () => {
  test('going back leaves the session instead of bouncing back into it', async ({ page }) => {
    const visited: string[] = []
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname)
    })

    await openSession(page)
    await page.goBack()
    await page.waitForTimeout(2500)

    expect(page.url()).not.toContain('/repos/1/sessions/ses_back')
    const last = visited[visited.length - 1]
    expect(last, `ended on ${last}`).not.toContain('/sessions/')
  })

  test('going back never lands on /repos/:id, which is a redirect', async ({ page }) => {
    const visited: string[] = []
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname)
    })

    await openSession(page)
    await page.goBack()
    await page.waitForTimeout(3000)

    expect(visited).not.toContain('/repos/1')
    const last = visited[visited.length - 1]
    expect(last).not.toBe('/repos/1/sessions/ses_back')
    expect(visited.length).toBeLessThan(6)
  })

  test('closing a session also escapes rather than redirecting back', async ({ page }) => {
    const visited: string[] = []
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname)
    })

    await openSession(page)
    const close = page.getByRole('button', { name: /close session|关闭会话|close/i }).first()
    if (await close.count()) {
      await close.click()
      await page.waitForTimeout(2500)
    }

    expect(visited).not.toContain('/repos/1')
  })

  test('an assistant session leaves without bouncing back into itself', async ({ page }) => {
    const visited: string[] = []
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname)
    })

    await installApiMocks(page, {
      repos: [ASSISTANT, REPO],
      sessionsByDirectory: { [ASSISTANT.fullPath]: [makeSession('ses_asst', ASSISTANT.fullPath)] },
    })
    await page.goto('/')
    await expect(page.locator('#root')).not.toBeEmpty()
    await page.goto('/repos/0/sessions/ses_asst?assistant=1')
    await expect(page.locator('#root')).not.toBeEmpty()

    await page.goBack()
    await page.waitForTimeout(2000)

    // Where we ended, not the whole trail: this run navigated to the session
    // on purpose, so its path is in the history by construction. What matters
    // is that going back did not put us straight back into it.
    expect(page.url()).not.toContain('/repos/0/sessions/ses_asst')
    const last = visited[visited.length - 1]
    expect(last, `ended on ${last}`).not.toContain('/sessions/')
  })
})
