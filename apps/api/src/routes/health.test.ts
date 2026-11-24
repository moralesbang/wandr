import { describe, expect, test } from 'bun:test'
import { app } from '../app.ts'

describe('GET /api/health', () => {
  test('answers up when the database and the bucket answer', async () => {
    const response = await app.request('/api/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'up',
      checks: { database: 'up', bucket: 'up' },
    })
  })

  test('is never cached', async () => {
    const response = await app.request('/api/health')

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('unknown API paths', () => {
  test('get the JSON 404, not the SPA', async () => {
    const response = await app.request('/api/nothing-here')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } })
  })
})
