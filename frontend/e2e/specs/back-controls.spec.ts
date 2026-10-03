import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, makeSession } from '../helpers/api-mocks'

const REPO = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }

async function signIn(page: Page) {
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: { id: 's1', userId: 'u1', expiresAt: '2099-01-01T00:00:00.000Z' },
        user: { id: 'u1', email: 'admin@opencode.local', name: 'Admin', role: 'admin' },
      }),
    }),
  )
  await page.route('**/api/auth-info/config', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  )
}

const BACK_CONTROL = /back|返回|go back|返回首页|返回项目/i

/**
 * Every page here is reached from the top bar, which is on every page, so a
 * back arrow in the page's own header duplicates it and - on a phone, where
 * the conversation header was the only such control on screen - looks like the
 * way out of a screen that has another one. The files page already made this
 * case; these are the rest.
 *
 * Asserting the absence is the only thing that keeps it from coming back.
 */
test.describe('页面不再自带返回控件', () => {
  test('定时任务页', async ({ page }) => {
    await signIn(page)
    await installApiMocks(page, { repos: [REPO] })

    await page.goto('/schedules')
    await expect(page.locator('#root')).not.toBeEmpty()

    await expect(page.getByRole('button', { name: BACK_CONTROL })).toHaveCount(0)
  })

  test('项目的定时任务页', async ({ page }) => {
    await signIn(page)
    await installApiMocks(page, {
      repos: [REPO],
      sessionsByDirectory: { [REPO.fullPath]: [makeSession('ses_1', REPO.fullPath)] },
    })

    await page.goto('/repos/1/schedules')
    await expect(page.locator('#root')).not.toBeEmpty()

    await expect(page.getByRole('button', { name: BACK_CONTROL })).toHaveCount(0)
  })

  test('会话页', async ({ page }) => {
    await signIn(page)
    await installApiMocks(page, {
      repos: [REPO],
      sessionsByDirectory: { [REPO.fullPath]: [makeSession('ses_1', REPO.fullPath)] },
    })

    await page.goto('/repos/1/sessions/ses_1')
    await expect(page.locator('#root')).not.toBeEmpty()

    await expect(page.getByRole('button', { name: BACK_CONTROL })).toHaveCount(0)
  })

  test('助手会话页', async ({ page }) => {
    await signIn(page)
    await installApiMocks(page, {
      repos: [{ id: 0, fullPath: '/workspace/repos/assistant', localPath: 'assistant', cloneStatus: 'ready' as const }],
      sessionsByDirectory: {
        '/workspace/repos/assistant': [makeSession('ses_a', '/workspace/repos/assistant')],
      },
    })

    await page.goto('/assistant')
    await expect(page.locator('#root')).not.toBeEmpty()

    await expect(page.getByRole('button', { name: BACK_CONTROL })).toHaveCount(0)
  })
})
