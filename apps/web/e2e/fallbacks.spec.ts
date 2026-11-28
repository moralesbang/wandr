import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

// The app's fallback screens: unknown address, page that didn't load, the mark shown before the
// app runs, the page that needs JavaScript, and the tab title. Every test drives the built SPA.

const LIGHT_BACKGROUND = [244, 238, 226] // #f4eee2
const DARK_BACKGROUND = [29, 27, 24] // #1d1b18

const NOT_FOUND_HEADING = "This path isn't on the map."
const NOT_FOUND_TEXT = 'The address may be mistyped, or the page may have moved.'
const ERROR_HEADING = "This page didn't load."
const BACK_LINK = 'Back to the start'

// A failure has to outlast the router's own one reload of the document before the error shows.
const ERROR_SCREEN_TIMEOUT = 20_000

const spikeControls = (page: Page) => page.getByRole('region', { name: 'Spike controls' })
const loadingMark = (page: Page) => page.getByRole('img', { name: 'Loading', exact: true })

// The mark is the Contour icon: an image served from /favicon.svg that decoded.
async function expectContourIcon(mark: Locator) {
  await expect
    .poll(() =>
      mark.evaluate((el) => {
        const img = el as HTMLImageElement
        return {
          path: new URL(img.currentSrc || img.src, location.href).pathname,
          decoded: img.complete && img.naturalWidth > 0,
        }
      }),
    )
    .toEqual({ path: '/favicon.svg', decoded: true })
}

const scriptPath = (url: string) => new URL(url).pathname

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function sizeOf(locator: Locator) {
  await expect(locator).toBeVisible()
  return locator.boundingBox()
}

// The scripts under /assets that a visit to `path` downloads, once `ready` holds.
async function scriptsOf(
  browser: Browser,
  baseURL: string,
  path: string,
  ready: (page: Page) => Promise<void>,
): Promise<Set<string>> {
  const context = await browser.newContext({ baseURL })
  try {
    const page = await context.newPage()
    const urls = new Set<string>()
    page.on('request', (request) => {
      const { pathname } = new URL(request.url())
      if (pathname.startsWith('/assets/') && pathname.endsWith('.js')) urls.add(pathname)
    })
    await page.goto(path)
    await ready(page)
    return urls
  } finally {
    await context.close()
  }
}

// The chunks only the route editor page needs: what its page loads and the home page does not.
// Blocking them leaves the app's main code, the home page and the fallbacks untouched.
const chunkCache = new Map<string, Promise<Set<string>>>()

function routeEditorChunks(browser: Browser, baseURL: string): Promise<Set<string>> {
  const known = chunkCache.get(baseURL)
  if (known) return known
  const found = (async () => {
    const home = await scriptsOf(browser, baseURL, '/', (page) =>
      expect(page.getByRole('heading', { name: 'Wandr', level: 1 })).toBeVisible(),
    )
    const editor = await scriptsOf(browser, baseURL, '/spike/route-editor', (page) =>
      expect(spikeControls(page)).toBeVisible({ timeout: 30_000 }),
    )
    const only = new Set([...editor].filter((path) => !home.has(path)))
    expect(only.size, 'the route editor page has chunks of its own').toBeGreaterThan(0)
    return only
  })()
  chunkCache.set(baseURL, found)
  return found
}

// Keeps the route editor's chunks from downloading until `release()`: they fail at once in mode
// `fail`, and wait for the release in mode `hold`. `requested` settles when one is first asked for.
async function interceptRouteEditor(page: Page, chunks: Set<string>, mode: 'fail' | 'hold') {
  let released = false
  const gate = deferred()
  const asked = deferred()
  await page.route('**/assets/*.js', async (route) => {
    if (released || !chunks.has(scriptPath(route.request().url()))) return route.continue()
    asked.resolve()
    if (mode === 'fail') return route.abort()
    await gate.promise
    return route.continue().catch(() => {})
  })
  const release = () => {
    released = true
    gate.resolve()
  }
  return { release, requested: asked.promise }
}

async function showErrorScreen(page: Page, chunks: Set<string>) {
  const blocked = await interceptRouteEditor(page, chunks, 'fail')
  await page.goto('/spike/route-editor')
  await expect(page.getByRole('heading', { name: ERROR_HEADING, exact: true })).toBeVisible({
    timeout: ERROR_SCREEN_TIMEOUT,
  })
  return blocked
}

// What a user sees on the page background: the first opaque background from the element at the
// top left corner up to the root, as red, green and blue.
function pageBackground(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d')!
    for (let el = document.elementFromPoint(2, 2); el; el = el.parentElement) {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = getComputedStyle(el).backgroundColor
      context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
      if (a === 255) return [r!, g!, b!]
    }
    return []
  })
}

function expectColor(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(3)
  for (const [i, channel] of expected.entries()) {
    expect(Math.abs(actual[i]! - channel)).toBeLessThanOrEqual(1)
  }
}

test.describe('an unknown address', () => {
  test('shows the not found copy and a link back to the start', async ({ page }) => {
    await page.goto('/nowhere')

    await expect(page.getByRole('heading', { name: NOT_FOUND_HEADING, exact: true })).toBeVisible()
    await expect(page.getByText(NOT_FOUND_TEXT, { exact: true })).toBeVisible()
    const back = page.getByRole('link', { name: BACK_LINK, exact: true })
    await expect(back).toBeVisible()

    await back.click()
    await expect(page.getByRole('heading', { name: 'Wandr', level: 1 })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
  })
})

test.describe('a page that cannot load', () => {
  test('shows the error copy, Try again and a link back to the start', async ({
    page,
    browser,
    baseURL,
  }) => {
    await showErrorScreen(page, await routeEditorChunks(browser, baseURL!))

    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    const back = page.getByRole('link', { name: BACK_LINK, exact: true })
    await expect(back).toBeVisible()

    await back.click()
    await expect(page.getByRole('heading', { name: 'Wandr', level: 1 })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('shows no technical detail', async ({ page, browser, baseURL }) => {
    await showErrorScreen(page, await routeEditorChunks(browser, baseURL!))

    // The text a user can read and every piece of text in the document, hidden ones included.
    const visible = await page.locator('body').innerText()
    const everything = await page.locator('body').evaluate((body) => body.textContent ?? '')
    const technical =
      /Something went wrong!|Show Error|Error|stack|Failed to|dynamically imported|Importing a module|\.js\b|\/assets\//
    expect(visible).not.toMatch(technical)
    expect(everything).not.toMatch(technical)
    await expect(page.getByRole('button', { name: /show error/i })).toHaveCount(0)
  })

  test('Try again shows the page that was asked for once its code downloads', async ({
    page,
    browser,
    baseURL,
  }) => {
    const blocked = await showErrorScreen(page, await routeEditorChunks(browser, baseURL!))
    blocked.release()

    await page.getByRole('button', { name: 'Try again', exact: true }).click()

    await expect(spikeControls(page)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: ERROR_HEADING, exact: true })).toHaveCount(0)
    expect(new URL(page.url()).pathname).toBe('/spike/route-editor')
  })
})

test.describe('the tab title', () => {
  test('follows the page, also after moving between pages without a reload', async ({ page }) => {
    await page.goto('/spike/route-editor')
    await expect(page).toHaveTitle('Route editor · Wandr')

    await page.goto('/nowhere')
    await expect(page).toHaveTitle('Page not found · Wandr')
    await page.evaluate(() => {
      Object.assign(window, { sameDocument: true })
    })

    await page.getByRole('link', { name: BACK_LINK, exact: true }).click()
    await expect(page).toHaveTitle('Wandr')

    await page.goBack()
    await expect(page).toHaveTitle('Page not found · Wandr')
    expect(await page.evaluate(() => 'sameDocument' in window)).toBe(true)

    await page.goto('/')
    await expect(page).toHaveTitle('Wandr')
  })

  test('reads "Page didn\'t load · Wandr" on the error screen', async ({
    page,
    browser,
    baseURL,
  }) => {
    await showErrorScreen(page, await routeEditorChunks(browser, baseURL!))

    await expect(page).toHaveTitle("Page didn't load · Wandr")
  })
})

test.describe('before the app runs', () => {
  for (const [scheme, background] of [
    ['light', LIGHT_BACKGROUND],
    ['dark', DARK_BACKGROUND],
  ] as const) {
    test.describe(`in ${scheme} mode`, () => {
      test.use({ colorScheme: scheme })

      test('any address shows the Contour mark: 64 x 64, centered, no text, on the page background', async ({
        page,
      }) => {
        await page.route('**/*.js', (route) => route.abort())

        for (const path of ['/', '/nowhere']) {
          await page.goto(path)

          const mark = loadingMark(page)
          await expect(mark).toBeVisible()
          await expectContourIcon(mark)
          const box = await mark.boundingBox()
          expect(box?.width).toBeCloseTo(64, 0)
          expect(box?.height).toBeCloseTo(64, 0)
          const viewport = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
          }))
          expect(box!.x + box!.width / 2).toBeCloseTo(viewport.width / 2, 0)
          expect(box!.y + box!.height / 2).toBeCloseTo(viewport.height / 2, 0)
          expect((await page.locator('body').innerText()).trim()).toBe('')
          expectColor(await pageBackground(page), background)
        }
      })
    })
  }

  test('a page without its own loading state keeps the mark while its code downloads', async ({
    page,
    browser,
    baseURL,
  }) => {
    const held = await interceptRouteEditor(
      page,
      await routeEditorChunks(browser, baseURL!),
      'hold',
    )

    await page.goto('/spike/route-editor', { waitUntil: 'commit' })
    await held.requested
    await expect(loadingMark(page)).toBeVisible()
    await expectContourIcon(loadingMark(page))
    await expect(spikeControls(page)).toHaveCount(0)

    held.release()
    await expect(spikeControls(page)).toBeVisible({ timeout: 30_000 })
    await expect(loadingMark(page)).toHaveCount(0)
  })
})

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false })

  for (const path of ['/', '/nowhere']) {
    test(`${path} says Wandr needs JavaScript and shows no loading mark`, async ({ page }) => {
      await page.goto(path)

      await expect(page.getByText('Wandr needs JavaScript.', { exact: true })).toBeVisible()
      await expect(
        page.getByText('Turn it on, then reload the page.', { exact: true }),
      ).toBeVisible()
      await expect(loadingMark(page)).toHaveCount(0)
    })
  }
})

test.describe('the fallback screens use touch targets of at least 44 x 44 px', () => {
  test('the link of the not found screen and the controls of the error screen', async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto('/nowhere')
    const notFoundLink = await sizeOf(page.getByRole('link', { name: BACK_LINK, exact: true }))
    expect(notFoundLink?.width).toBeGreaterThanOrEqual(44)
    expect(notFoundLink?.height).toBeGreaterThanOrEqual(44)

    await showErrorScreen(page, await routeEditorChunks(browser, baseURL!))
    for (const control of [
      page.getByRole('button', { name: 'Try again', exact: true }),
      page.getByRole('link', { name: BACK_LINK, exact: true }),
    ]) {
      const box = await sizeOf(control)
      expect(box?.width).toBeGreaterThanOrEqual(44)
      expect(box?.height).toBeGreaterThanOrEqual(44)
    }
  })
})
