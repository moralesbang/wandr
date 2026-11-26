import { expect, test, type Page } from '@playwright/test'

type Icon = { url: string; type: 'image/svg+xml' | 'image/png'; size?: number; purpose?: string }
type Manifest = { icons?: { src: string; sizes?: string; type?: string; purpose?: string }[] }

const MOSS = [0x4f, 0x63, 0x30]
const TERRACOTTA = [0xe3, 0x9a, 0x7a]
const TOLERANCE = 24

async function declaredIcons(page: Page): Promise<Icon[]> {
  await page.goto('/')
  const links = await page.evaluate(() =>
    [
      ...document.head.querySelectorAll<HTMLLinkElement>(
        'link[rel~="icon"], link[rel="apple-touch-icon"]',
      ),
    ].map((l) => ({
      type: l.getAttribute('type') ?? '',
      sizes: l.getAttribute('sizes') ?? '',
      href: l.href,
    })),
  )
  const manifestHref = await page.evaluate(
    () => document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href ?? '',
  )
  const manifest = (await (await page.request.get(manifestHref)).json()) as Manifest
  const icons: Icon[] = []
  for (const l of links) {
    if (l.type === 'image/svg+xml') icons.push({ url: l.href, type: 'image/svg+xml' })
    else if (l.sizes)
      icons.push({ url: l.href, type: 'image/png', size: Number(l.sizes.split('x')[0]) })
  }
  for (const i of manifest.icons ?? []) {
    icons.push({
      url: new URL(i.src, manifestHref).href,
      type: 'image/png',
      size: Number((i.sizes ?? '').split('x')[0]),
      purpose: i.purpose ?? 'any',
    })
  }
  return icons
}

async function pixels(page: Page, url: string) {
  return page.evaluate(async (u) => {
    const blob = await (await fetch(u)).blob()
    const bmp = await createImageBitmap(blob)
    const w = bmp.width || 64
    const h = bmp.height || 64
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bmp, 0, 0, w, h)
    const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data]
    const all = ctx.getImageData(0, 0, w, h).data
    let minAlpha = 255
    for (let i = 3; i < all.length; i += 4) minAlpha = Math.min(minAlpha, all[i]!)
    return {
      width: bmp.width,
      height: bmp.height,
      center: at(Math.floor(w / 2), Math.floor(h / 2)),
      edge: at(Math.floor(w * 0.08), Math.floor(h / 2)),
      minAlpha,
    }
  }, url)
}

function near(actual: number[], expected: number[]) {
  expect(actual[3]).toBeGreaterThan(240)
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(TOLERANCE)
  }
}

test('the home page links an SVG favicon, a 32px PNG favicon and a 180px apple-touch-icon', async ({
  page,
}) => {
  await page.goto('/')
  const head = page.locator('head')
  await expect(head.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1)
  await expect(head.locator('link[rel="icon"][sizes="32x32"]')).toHaveCount(1)
  await expect(head.locator('link[rel="apple-touch-icon"][sizes="180x180"]')).toHaveCount(1)
})

test('the manifest lists 192 and 512 any icons and a 512 maskable icon, all PNG', async ({
  page,
}) => {
  const icons = (await declaredIcons(page)).filter((i) => i.purpose)
  expect(icons.map((i) => `${i.type} ${i.size} ${i.purpose}`).toSorted()).toEqual([
    'image/png 192 any',
    'image/png 512 any',
    'image/png 512 maskable',
  ])
})

test('every declared icon answers 200 with its type, and each PNG has the size it declares', async ({
  page,
}) => {
  const icons = await declaredIcons(page)
  expect(icons).toHaveLength(6)
  for (const icon of icons) {
    const res = await page.request.get(icon.url)
    expect(res.status(), icon.url).toBe(200)
    expect(res.headers()['content-type'], icon.url).toContain(icon.type)
    if (icon.size) {
      const px = await pixels(page, icon.url)
      expect([px.width, px.height], icon.url).toEqual([icon.size, icon.size])
    }
  }
})

test('every icon draws the Contour mark: terracotta find at the center, moss tile around it', async ({
  page,
}) => {
  const icons = await declaredIcons(page)
  expect(icons).toHaveLength(6)
  for (const icon of icons) {
    const px = await pixels(page, icon.url)
    near(px.center, TERRACOTTA)
    near(px.edge, MOSS)
  }
})

test('the apple-touch-icon and the maskable icon have no transparent pixel', async ({ page }) => {
  const icons = (await declaredIcons(page)).filter(
    (i) => i.size === 180 || i.purpose === 'maskable',
  )
  expect(icons).toHaveLength(2)
  for (const icon of icons) {
    const px = await pixels(page, icon.url)
    expect(px.minAlpha, icon.url).toBe(255)
  }
})
