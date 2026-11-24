import type { RoutePoint } from '@wandr/sharing'
import { describe, expect, test } from 'vitest'
import { appendPoint, deletePoint, insertPointAfter, midpoints, movePoint } from './route-edits'

const point = (id: string, lng: number): RoutePoint => ({ id, lng, lat: 6 })
const route = [point('a', 0), point('b', 2), point('c', 4)]
const ids = (points: readonly { id: string }[]) => points.map(({ id }) => id)

describe('route edits', () => {
  test('appending adds the point at the end', () => {
    expect(ids(appendPoint(route, point('d', 6)))).toEqual(['a', 'b', 'c', 'd'])
  })

  test('inserting places the point right after the one named', () => {
    expect(ids(insertPointAfter(route, 'a', point('x', 1)))).toEqual(['a', 'x', 'b', 'c'])
  })

  test('inserting after a point no longer on the route changes nothing', () => {
    expect(ids(insertPointAfter(route, 'gone', point('x', 1)))).toEqual(['a', 'b', 'c'])
  })

  test('moving a point keeps its ID and its place', () => {
    const moved = movePoint(route, 'b', { lng: 9, lat: 7 })
    expect(moved[1]).toEqual({ id: 'b', lng: 9, lat: 7 })
    expect(ids(moved)).toEqual(['a', 'b', 'c'])
  })

  test('deleting a point joins its neighbours', () => {
    expect(ids(deletePoint(route, 'b'))).toEqual(['a', 'c'])
  })

  test('there is a midpoint halfway between each pair of points', () => {
    expect(midpoints(route)).toEqual([
      { afterPointId: 'a', at: { lng: 1, lat: 6 } },
      { afterPointId: 'b', at: { lng: 3, lat: 6 } },
    ])
    expect(midpoints([point('a', 0)])).toEqual([])
  })
})
