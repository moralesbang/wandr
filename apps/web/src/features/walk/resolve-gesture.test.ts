import { describe, expect, test } from 'vitest'
import { resolveGesture, type GestureTarget, type Tool } from './resolve-gesture'

const targets: GestureTarget[] = [
  { kind: 'map' },
  { kind: 'find', findId: 'f1' },
  { kind: 'handle', afterPointId: 'p1' },
]

describe('the delete key', () => {
  test('deletes a route point in the Route tool', () => {
    expect(resolveGesture('route', { kind: 'point', pointId: 'p1' }, 'delete-key')).toEqual({
      type: 'delete-point',
      pointId: 'p1',
    })
  })

  test.each(['view', 'add-find'] as Tool[])('does nothing on a point in the %s tool', (tool) => {
    expect(resolveGesture(tool, { kind: 'point', pointId: 'p1' }, 'delete-key')).toEqual({
      type: 'none',
    })
  })

  test.each(targets)('does nothing on $kind in the Route tool', (target) => {
    expect(resolveGesture('route', target, 'delete-key')).toEqual({ type: 'none' })
  })
})
