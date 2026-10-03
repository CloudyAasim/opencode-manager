import { test, expect } from '@playwright/test'
import { installApiMocks, makeSession } from '../helpers/api-mocks'

test.describe('repo entry route', () => {
  test('lands on a composer and does not bounce to the newest session', async ({ page }) => {
    const repo = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
    await installApiMocks(page, {
      repos: [repo],
      sessionsByDirectory: { [repo.fullPath]: [makeSession('ses_newest', repo.fullPath)] },
    })

    await page.goto('/repos/1')

    // A project opens a conversation you can type into. It is not a hop to the
    // newest session any more - that is the point of the change.
    await expect(page).toHaveURL(/\/repos\/1$/)
    await expect(page.locator('textarea, input[type="text"]').first()).toBeVisible({ timeout: 15000 })
    await expect(page).not.toHaveURL(/\/sessions\//)
  })

  test('a slow session list does not stand between you and the composer', async ({ page }) => {
    const repo = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
    await installApiMocks(page, {
      repos: [repo],
      sessionsByDirectory: { [repo.fullPath]: [makeSession('ses_slow', repo.fullPath)] },
      latency: { repoMs: 1200, sessionsMs: 1500 },
    })

    await page.goto('/repos/1')

    // The entry no longer asks for the session list at all, so its latency is
    // irrelevant - which is the whole reason the hop could go.
    await expect(page.locator('textarea, input[type="text"]').first()).toBeVisible({ timeout: 20000 })
    await expect(page).not.toHaveURL(/undefined/)
  })

  test('never navigates to a session id of undefined', async ({ page }) => {
    const repo = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
    await installApiMocks(page, {
      repos: [repo],
      sessionsByDirectory: { [repo.fullPath]: [] },
      latency: { repoMs: 300, sessionsMs: 900 },
    })

    const seen: string[] = []
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) seen.push(frame.url())
    })

    await page.goto('/repos/1')
    await page.waitForTimeout(6000)

    expect(seen.filter((url) => url.includes('/sessions/undefined'))).toHaveLength(0)
  })

  test('a repo with no sessions lands on a usable session page, not a not-found screen', async ({ page }) => {
    const repo = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
    await installApiMocks(page, {
      repos: [repo],
      sessionsByDirectory: { [repo.fullPath]: [] },
    })

    await page.goto('/repos/1')
    await page.waitForTimeout(4000)

    const body = await page.locator('body').innerText()
    expect(body).not.toContain('未找到会话')
    expect(body).not.toContain('Session not found')
    expect(body).not.toContain('返回会话列表')
    expect(body).not.toContain('Back to sessions')
  })

  test('the session page exposes the worktree switcher that used to live on the project page', async ({ page }) => {
    const repo = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
    await installApiMocks(page, {
      repos: [repo],
      sessionsByDirectory: { [repo.fullPath]: [makeSession('ses_a', repo.fullPath)] },
    })

    // Straight to a session: the switcher lives on the session page, and the
    // project entry is no longer a way to get there.
    await page.goto('/repos/1/sessions/ses_a')

    await expect(page.locator('body')).toContainText(/Workspace|工作区/, { timeout: 15000 })
  })
})

test.describe('repo entry route failures', () => {
  test('shows the repository-not-found fallback for an unknown repo instead of a blank page', async ({ page }) => {
    await installApiMocks(page, { repos: [] })

    await page.goto('/repos/999')

    const body = page.locator('body')
    await expect(body).toContainText(/Repository not found|未找到仓库|仓库不存在/, { timeout: 15000 })
    await expect(body).toContainText(/Back to repositories|返回仓库列表|返回项目列表/)
  })
})
