import { expect, test, type Locator, type Page } from '@playwright/test'

// Deleting a route point with the keyboard (docs/04-flows.md §5): in the Route tool, Delete or
// Backspace on a focused point removes it. Every test drives the route editor spike's built SPA.

const MAP_LOADS = 30_000

type Tool = 'View' | 'Add find' | 'Route'
type Key = 'Delete' | 'Backspace'
const KEYS: Key[] = ['Delete', 'Backspace']

const points = (page: Page) => page.getByRole('button', { name: /^Point \d+$/ })
const point = (page: Page, n: number) =>
  page.getByRole('button', { name: `Point ${n}`, exact: true })
const sampleRoute = (page: Page) => page.getByRole('button', { name: 'Sample route', exact: true })
const clearRoute = (page: Page) => page.getByRole('button', { name: 'Clear route', exact: true })
const deletePointButton = (page: Page) =>
  page.getByRole('button', { name: 'Delete point', exact: true })

async function pickTool(page: Page, tool: Tool) {
  const radio = page
    .getByRole('radiogroup', { name: 'Map tool' })
    .getByRole('radio', { name: tool, exact: true })
  await expect(radio).toBeVisible()
  await radio.click()
  await expect(radio).toBeChecked()
}

async function drawSampleRoute(page: Page) {
  await page.goto('/spike/route-editor')
  await expect(sampleRoute(page)).toBeVisible({ timeout: MAP_LOADS })
  await pickTool(page, 'Route')
  await sampleRoute(page).click()
  await expect(points(page)).toHaveCount(10)
}

// WebKit goes back in history on Backspace outside a text field, which would unload the page
// this test still has to read. A listener added after the app's own keeps the page, and leaves
// what the app does with the key as it is.
async function keepPageOnBackspace(page: Page) {
  await page.evaluate(() => {
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace') event.preventDefault()
    })
  })
}

async function focusPoint(page: Page, n: number): Promise<Locator> {
  const target = point(page, n)
  await expect(target).toBeVisible()
  await target.focus()
  await expect(target).toBeFocused()
  return target
}

// The centers of the points on screen, in route order.
async function centers(page: Page): Promise<{ x: number; y: number }[]> {
  return points(page).evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect()
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
    }),
  )
}

test.describe('deleting a route point with the keyboard', () => {
  for (const key of KEYS) {
    test(`AC1/AC2: ${key} on a focused "Point 3" removes it in the Route tool`, async ({
      page,
    }) => {
      await drawSampleRoute(page)
      await focusPoint(page, 3)

      await page.keyboard.press(key)

      await expect(points(page)).toHaveCount(9)
      await expect(point(page, 10)).toHaveCount(0)
    })
  }

  test('AC3: the other points keep their order and places', async ({ page }) => {
    await drawSampleRoute(page)
    const before = await centers(page)
    expect(before).toHaveLength(10)
    await focusPoint(page, 3)

    await page.keyboard.press('Delete')

    await expect(points(page)).toHaveCount(9)
    const expected = before.filter((_, index) => index !== 2)
    expect(await centers(page)).toEqual(expected)
  })

  // Each negative case first proves the key works in the Route tool, so a key that never does
  // anything cannot pass it.
  for (const tool of ['View', 'Add find'] as const) {
    for (const key of KEYS) {
      test(`AC4: ${key} on a focused point removes nothing in the ${tool} tool`, async ({
        page,
      }) => {
        await drawSampleRoute(page)
        await focusPoint(page, 3)
        await page.keyboard.press(key)
        await expect(points(page)).toHaveCount(9)

        await sampleRoute(page).click()
        await expect(points(page)).toHaveCount(10)
        await pickTool(page, tool)
        await focusPoint(page, 3)
        await keepPageOnBackspace(page)
        await page.keyboard.press(key)

        await expect(points(page)).toHaveCount(10)
        await expect(point(page, 3)).toBeVisible()
      })
    }
  }

  for (const key of KEYS) {
    test(`AC5: ${key} on the "Clear route" button removes no point in the Route tool`, async ({
      page,
    }) => {
      await drawSampleRoute(page)
      await focusPoint(page, 3)
      await page.keyboard.press(key)
      await expect(points(page)).toHaveCount(9)

      await sampleRoute(page).click()
      await expect(points(page)).toHaveCount(10)
      await clearRoute(page).focus()
      await expect(clearRoute(page)).toBeFocused()
      await keepPageOnBackspace(page)
      await page.keyboard.press(key)

      await expect(points(page)).toHaveCount(10)
    })
  }

  test('AC6: the "Delete point" button is not shown after a key deletion', async ({ page }) => {
    await drawSampleRoute(page)
    // Point 5: on a phone's screen, Point 3 is off the map's edge and can't be tapped.
    await point(page, 5).click()
    await expect(deletePointButton(page)).toBeVisible()
    // Safari doesn't focus a button on click.
    await focusPoint(page, 5)

    await page.keyboard.press('Delete')

    await expect(points(page)).toHaveCount(9)
    await expect(deletePointButton(page)).toHaveCount(0)
  })
})
