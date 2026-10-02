import { test, expect, type Page } from '@playwright/test'

const CONFIG = {
  enabledProviders: ['credentials'],
  registrationEnabled: true,
  isFirstUser: false,
  adminConfigured: true,
}

async function signedOut(page: Page) {
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session: null, user: null }),
    }),
  )
  await page.route('**/api/auth-info/config', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONFIG) }),
  )
  await page.route('**/api/sse/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  )
  await page.route('**/api/health**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'healthy' }) }),
  )
}

for (const route of ['/login', '/register']) {
  test(`${route} shows no app chrome while signed out`, async ({ page }) => {
    await signedOut(page)
    await page.goto(route)
    await page.waitForTimeout(1200)

    const seen = await page.evaluate(() => ({
      headers: document.querySelectorAll('header').length,
      asides: document.querySelectorAll('aside').length,
      topBar: document.body.innerText.includes('shell.repo.all'),
      form: document.querySelectorAll('form').length,
      path: location.pathname,
    }))

    expect(seen.path).toBe(route)
    expect(seen.form).toBeGreaterThan(0)
    expect(seen.headers).toBe(0)
    expect(seen.asides).toBe(0)
    expect(seen.topBar).toBe(false)
  })
}
