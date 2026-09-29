import { test, expect } from '@playwright/test'
import { installApiMocks } from '../helpers/api-mocks'

const PUBLIC_ROUTES = ['/login', '/register']

for (const route of PUBLIC_ROUTES) {
  test(`${route} renders the app shell`, async ({ page }) => {
    const pageErrors: string[] = []
    const assetFailures: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
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
    expect(pageErrors).toEqual([])
    expect(assetFailures).toEqual([])
  })
}

test('an unauthenticated visit to a protected route never leaves the app blank', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await installApiMocks(page)
  await page.goto('/repos/1')
  await page.waitForTimeout(2500)

  expect(pageErrors).toEqual([])
  expect(await page.locator('#root').innerHTML()).not.toHaveLength(0)
})

test('no route in the suite produces an uncaught error', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await installApiMocks(page)
  for (const route of ['/login', '/repos/1', '/settings', '/files', '/schedules']) {
    await page.goto(route)
    await page.waitForTimeout(800)
  }

  expect(pageErrors).toEqual([])
})
