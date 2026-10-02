import { test, expect, type Page } from '@playwright/test'
import { installApiMocks } from '../helpers/api-mocks'

function collectFailures(page: Page): { pageErrors: string[]; consoleErrors: string[] } {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.includes('Download the React DevTools')) return
    consoleErrors.push(text)
  })
  return { pageErrors, consoleErrors }
}

const PUBLIC_ROUTES = ['/login', '/register']

for (const route of PUBLIC_ROUTES) {
  test(`${route} renders the app shell`, async ({ page }) => {
    const failures = collectFailures(page)
    const assetFailures: string[] = []
    page.on('response', (response) => {
      if (response.status() >= 400 && response.url().includes('/assets/')) {
        assetFailures.push(`${response.status()} ${response.url()}`)
      }
    })

    await installApiMocks(page)
    await page.goto(route)

    const root = page.locator('#root')
    await expect(root).not.toBeEmpty()
    expect(await page.locator('body').innerText()).not.toHaveLength(0)
    expect(failures.pageErrors).toEqual([])
    expect(failures.consoleErrors).toEqual([])
    expect(assetFailures).toEqual([])
  })
}

test('an unauthenticated visit to a protected route never leaves the app blank', async ({ page }) => {
  const failures = collectFailures(page)

  await installApiMocks(page)
  await page.goto('/repos/1')
  await page.waitForTimeout(2500)

  expect(failures.pageErrors).toEqual([])
  expect(failures.consoleErrors).toEqual([])
  expect(await page.locator('#root').innerHTML()).not.toHaveLength(0)
})

test('no route in the suite produces an uncaught error', async ({ page }) => {
  const failures = collectFailures(page)

  await installApiMocks(page)
  for (const route of ['/login', '/repos/1', '/settings', '/files', '/schedules']) {
    await page.goto(route)
    await page.waitForTimeout(800)
  }

  expect(failures.pageErrors).toEqual([])
  expect(failures.consoleErrors).toEqual([])
})

const RAW_KEY = /\b[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+){2,}\b/
const INTERACTIVE = 'a, button, [role="button"], [role="tab"], [role="option"], label, h1, h2, h3, p, span, li'

function rawKeysIn(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(
    ({ pattern, selector }) => {
      const re = new RegExp(pattern)
      const hits: string[] = []
      for (const node of document.querySelectorAll(selector)) {
        if (node.children.length > 0) continue
        const text = (node.textContent ?? '').trim()
        if (text && re.test(text) && !text.includes(' ')) hits.push(text)
      }
      return [...new Set(hits)]
    },
    { pattern: RAW_KEY.source, selector: INTERACTIVE },
  )
}

test('no route paints a raw translation key', async ({ page }) => {
  await installApiMocks(page)
  const found: string[] = []

  for (const route of ['/', '/files', '/settings', '/schedules']) {
    await page.goto(route)
    await page.waitForTimeout(700)
    for (const key of await rawKeysIn(page)) found.push(`${route} -> ${key}`)
  }

  expect(
    found,
    [
      `界面上出现了 ${found.length} 个未翻译的 key：`,
      ...found,
      'i18next 找不到键时返回键本身，不报错，所以这类问题只能靠断言拦。',
    ].join('\n'),
  ).toEqual([])
})
