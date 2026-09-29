import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, makeSession } from '../helpers/api-mocks'

const REPO = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }

async function openSessionPage(page: Page) {
  await installApiMocks(page, {
    repos: [REPO],
    sessionsByDirectory: { [REPO.fullPath]: [makeSession('ses_panel', REPO.fullPath)] },
  })
  await page.goto('/repos/1/sessions/ses_panel')
  await expect(page.locator('#root')).not.toBeEmpty()
}

async function openRightPanel(page: Page) {
  await expect(page.getByRole('button', { name: /detail|详情/i }).first()).toBeVisible({ timeout: 15000 })
  if (await panelSeparator(page).count() === 0) {
    await page.getByRole('button', { name: /detail|详情/i }).first().click()
  }
  await expect(panelSeparator(page)).toHaveCount(1)
}

function panelSeparator(page: Page) {
  return page.locator('[role="separator"][aria-label]')
}

function panelAside(page: Page) {
  return page.locator('aside').last()
}

test.describe('right panel resize', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, 'resize handle is desktop only')

  test('the separator sits on the panel edge, not somewhere in the layout', async ({ page }) => {
    await openSessionPage(page)
    await openRightPanel(page)

    const handle = (await panelSeparator(page).boundingBox())!
    const panel = (await panelAside(page).boundingBox())!
    const panelLeftEdge = panel.x

    expect(Math.abs(handle.x - panelLeftEdge)).toBeLessThan(12)
  })

  test('dragging the separator changes the panel width', async ({ page }) => {
    await openSessionPage(page)
    await openRightPanel(page)

    const before = (await panelAside(page).boundingBox())!.width
    const handle = (await panelSeparator(page).boundingBox())!

    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 - 160, handle.y + handle.height / 2, { steps: 12 })
    await page.mouse.up()

    const after = (await panelAside(page).boundingBox())!.width
    expect(after).toBeGreaterThan(before + 40)
  })

  test('dragging past the maximum clamps instead of collapsing the panel', async ({ page }) => {
    await openSessionPage(page)
    await openRightPanel(page)

    const handle = (await panelSeparator(page).boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x - 2000, handle.y + handle.height / 2, { steps: 20 })
    await page.mouse.up()

    const width = (await panelAside(page).boundingBox())!.width
    expect(width).toBeLessThanOrEqual(760)
    expect(width).toBeGreaterThan(200)
  })

  test('the separator is keyboard operable', async ({ page }) => {
    await openSessionPage(page)
    await openRightPanel(page)

    const separator = panelSeparator(page)
    await separator.focus()

    const before = (await panelAside(page).boundingBox())!.width
    await page.keyboard.press('ArrowLeft')
    const after = (await panelAside(page).boundingBox())!.width

    expect(after).toBeGreaterThan(before)
  })

  test('the panel width survives a reload', async ({ page }) => {
    await openSessionPage(page)
    await openRightPanel(page)

    const handle = (await panelSeparator(page).boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x - 140, handle.y + handle.height / 2, { steps: 10 })
    await page.mouse.up()

    const resized = (await panelAside(page).boundingBox())!.width
    await page.reload()
    await openRightPanel(page)

    const restored = (await panelAside(page).boundingBox())!.width
    expect(Math.abs(restored - resized)).toBeLessThan(8)
  })
})
