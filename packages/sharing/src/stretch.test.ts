import { describe, expect, test } from 'bun:test'
import { pointsInStretch, type RoutePoint } from './stretch.ts'

const route: RoutePoint[] = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
  id,
  lat: 6.24 + index / 1000,
  lng: -75.59,
}))

const ids = (points: RoutePoint[]) => points.map((point) => point.id)

describe('pointsInStretch', () => {
  test.each([
    {
      row: 'ends in route order show the points between them, both ends included',
      startId: 'b',
      endId: 'd',
      shown: ['b', 'c', 'd'],
    },
    {
      row: 'ends in reverse order show the same points, in route order',
      startId: 'd',
      endId: 'b',
      shown: ['b', 'c', 'd'],
    },
    {
      row: 'neighbouring ends show just the two of them',
      startId: 'a',
      endId: 'b',
      shown: ['a', 'b'],
    },
    {
      row: 'the first and last points show the whole route',
      startId: 'a',
      endId: 'e',
      shown: ['a', 'b', 'c', 'd', 'e'],
    },
    { row: 'the same point at both ends shows no route', startId: 'c', endId: 'c', shown: [] },
    { row: 'an end no longer on the route shows no route', startId: 'b', endId: 'gone', shown: [] },
  ])('$row', ({ startId, endId, shown }) => {
    expect(ids(pointsInStretch(route, { startId, endId }))).toEqual([...shown])
  })

  test('a route with fewer than two points shows no route', () => {
    expect(pointsInStretch(route.slice(0, 1), { startId: 'a', endId: 'b' })).toEqual([])
    expect(pointsInStretch([], { startId: 'a', endId: 'b' })).toEqual([])
  })
})
