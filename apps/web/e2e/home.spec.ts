import { expect, test } from '@playwright/test'

test('the home page shows that the API, the database and the bucket answer', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Wandr', level: 1 })).toBeVisible()
  const services = page.getByRole('list', { name: 'Services' }).getByRole('listitem')
  await expect(services).toHaveText([
    /^API\s*Answering$/,
    /^Database\s*Answering$/,
    /^Photo storage\s*Answering$/,
  ])
})

test('a deep link gets the SPA, and an unknown API path does not', async ({ page, request }) => {
  const spa = await page.goto('/walks/anything')
  expect(spa?.headers()['content-type']).toContain('text/html')

  const api = await request.get('/api/nothing-here')
  expect(api.status()).toBe(404)
  expect(api.headers()['content-type']).toContain('application/json')
})
