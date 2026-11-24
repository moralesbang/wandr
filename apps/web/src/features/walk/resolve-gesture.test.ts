import { describe, expect, test } from 'vitest'
import {
  dragEdits,
  type EditorAction,
  type Gesture,
  type GestureTarget,
  resolveGesture,
  type Tool,
} from './resolve-gesture'

const map: GestureTarget = { kind: 'map' }
const find: GestureTarget = { kind: 'find', findId: 'f1' }
const point: GestureTarget = { kind: 'point', pointId: 'p1' }
const handle: GestureTarget = { kind: 'handle', afterPointId: 'p1' }

type Cell = { cell: string; target: GestureTarget; gesture: Gesture; action: EditorAction }

// One case per cell of the tools table in docs/04-flows.md §2 (testing T-003).
const rows: { tool: Tool; cells: Cell[] }[] = [
  {
    tool: 'view',
    cells: [
      {
        cell: 'tap on the empty map: nothing',
        target: map,
        gesture: 'tap',
        action: { type: 'none' },
      },
      {
        cell: 'tap on a find: opens it',
        target: find,
        gesture: 'tap',
        action: { type: 'open-find', findId: 'f1' },
      },
      {
        cell: 'tap on a route point: nothing',
        target: point,
        gesture: 'tap',
        action: { type: 'none' },
      },
      { cell: 'drag a find: pans', target: find, gesture: 'drag', action: { type: 'pan' } },
      { cell: 'drag a route point: pans', target: point, gesture: 'drag', action: { type: 'pan' } },
      {
        cell: 'drag a midpoint handle: no handles shown',
        target: handle,
        gesture: 'drag',
        action: { type: 'none' },
      },
    ],
  },
  {
    tool: 'add-find',
    cells: [
      {
        cell: 'tap on the empty map: places a new find',
        target: map,
        gesture: 'tap',
        action: { type: 'place-find' },
      },
      {
        cell: 'tap on a find: opens it',
        target: find,
        gesture: 'tap',
        action: { type: 'open-find', findId: 'f1' },
      },
      {
        cell: 'tap on a route point: nothing',
        target: point,
        gesture: 'tap',
        action: { type: 'none' },
      },
      {
        cell: 'drag a find: moves it',
        target: find,
        gesture: 'drag',
        action: { type: 'move-find', findId: 'f1' },
      },
      { cell: 'drag a route point: pans', target: point, gesture: 'drag', action: { type: 'pan' } },
      {
        cell: 'drag a midpoint handle: no handles shown',
        target: handle,
        gesture: 'drag',
        action: { type: 'none' },
      },
    ],
  },
  {
    tool: 'route',
    cells: [
      {
        cell: 'tap on the empty map: adds a point at the end',
        target: map,
        gesture: 'tap',
        action: { type: 'append-point' },
      },
      { cell: 'tap on a find: nothing', target: find, gesture: 'tap', action: { type: 'none' } },
      {
        cell: 'tap on a route point: selects it',
        target: point,
        gesture: 'tap',
        action: { type: 'select-point', pointId: 'p1' },
      },
      { cell: 'drag a find: pans', target: find, gesture: 'drag', action: { type: 'pan' } },
      {
        cell: 'drag a route point: moves it',
        target: point,
        gesture: 'drag',
        action: { type: 'move-point', pointId: 'p1' },
      },
      {
        cell: 'drag a midpoint handle: inserts a point there',
        target: handle,
        gesture: 'drag',
        action: { type: 'insert-point', afterPointId: 'p1' },
      },
    ],
  },
]

describe('resolveGesture', () => {
  describe.each(rows)('$tool tool', ({ tool, cells }) => {
    test.each(cells)('$cell', ({ target, gesture, action }) => {
      expect(resolveGesture(tool, target, gesture)).toEqual(action)
    })
  })

  // The rules for every tool, under the table.
  test.each<Tool>(['view', 'add-find', 'route'])('%s tool: dragging the empty map pans', (tool) => {
    expect(resolveGesture(tool, map, 'drag')).toEqual({ type: 'pan' })
  })

  test.each<Tool>(['view', 'add-find', 'route'])(
    '%s tool: tapping a midpoint handle does nothing',
    (tool) => {
      expect(resolveGesture(tool, handle, 'tap')).toEqual({ type: 'none' })
    },
  )
})

describe('dragEdits', () => {
  test.each([
    { tool: 'view', target: find, edits: false },
    { tool: 'view', target: point, edits: false },
    { tool: 'add-find', target: find, edits: true },
    { tool: 'add-find', target: point, edits: false },
    { tool: 'route', target: point, edits: true },
    { tool: 'route', target: handle, edits: true },
    { tool: 'route', target: find, edits: false },
    { tool: 'route', target: map, edits: false },
  ] satisfies { tool: Tool; target: GestureTarget; edits: boolean }[])(
    '$tool tool, drag on $target.kind: edits is $edits',
    ({ tool, target, edits }) => {
      expect(dragEdits(tool, target)).toBe(edits)
    },
  )
})
