/**
 * The map editor's rule: what a tap or a drag does, for each tool and each thing on the map.
 * It follows the tools table in docs/04-flows.md §2 row by row (web WEB-009). Map components
 * only report gestures and apply the action this returns.
 */

export type Tool = 'view' | 'add-find' | 'route'

/** What a press starts on. A midpoint handle sits between `afterPointId` and the next point. */
export type GestureTarget =
  | { kind: 'map' }
  | { kind: 'find'; findId: string }
  | { kind: 'point'; pointId: string }
  | { kind: 'handle'; afterPointId: string }

/** `delete-key` is Delete or Backspace pressed with the target focused. */
export type Gesture = 'tap' | 'drag' | 'delete-key'

export type EditorAction =
  | { type: 'none' }
  | { type: 'pan' }
  | { type: 'open-find'; findId: string }
  | { type: 'place-find' }
  | { type: 'move-find'; findId: string }
  | { type: 'append-point' }
  | { type: 'select-point'; pointId: string }
  | { type: 'move-point'; pointId: string }
  | { type: 'insert-point'; afterPointId: string }
  | { type: 'delete-point'; pointId: string }

const none: EditorAction = { type: 'none' }
const pan: EditorAction = { type: 'pan' }

/** Whether a drag that starts on `target` edits it, rather than panning the map. */
export const dragEdits = (tool: Tool, target: GestureTarget): boolean => {
  const action = resolveGesture(tool, target, 'drag').type
  return action !== 'pan' && action !== 'none'
}

export const resolveGesture = (
  tool: Tool,
  target: GestureTarget,
  gesture: Gesture,
): EditorAction => {
  // Only a route point in the Route tool answers the key.
  if (gesture === 'delete-key') {
    return tool === 'route' && target.kind === 'point'
      ? { type: 'delete-point', pointId: target.pointId }
      : none
  }

  switch (target.kind) {
    // Dragging the empty map always moves it, whatever the tool.
    case 'map':
      if (gesture === 'drag') return pan
      if (tool === 'add-find') return { type: 'place-find' }
      if (tool === 'route') return { type: 'append-point' }
      return none

    case 'find':
      if (gesture === 'tap') {
        return tool === 'route' ? none : { type: 'open-find', findId: target.findId }
      }
      return tool === 'add-find' ? { type: 'move-find', findId: target.findId } : pan

    case 'point':
      if (tool !== 'route') return gesture === 'drag' ? pan : none
      return gesture === 'tap'
        ? { type: 'select-point', pointId: target.pointId }
        : { type: 'move-point', pointId: target.pointId }

    // Handles show only in the Route tool, and only a drag inserts a point.
    case 'handle':
      if (tool !== 'route' || gesture === 'tap') return none
      return { type: 'insert-point', afterPointId: target.afterPointId }
  }
}
