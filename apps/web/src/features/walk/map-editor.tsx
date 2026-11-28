import type { RoutePoint } from '@wandr/sharing'
import { type ReactNode, useRef, useState } from 'react'
import type { MapLayerMouseEvent } from 'react-map-gl/maplibre'
import { BaseMap, type BaseMapProps } from '@/components/map/base-map'
import { FindMarker } from '@/components/map/find-marker'
import { MidpointHandle } from '@/components/map/midpoint-handle'
import { RouteLine } from '@/components/map/route-line'
import { RoutePoint as RoutePointMarker } from '@/components/map/route-point'
import type { LngLat, MarkerPress } from '@/components/map/use-marker-press'
import {
  dragEdits,
  type EditorAction,
  type Gesture,
  type GestureTarget,
  resolveGesture,
  type Tool,
} from './resolve-gesture'
import { insertPointAfter, midpoints, movePoint } from './route-edits'

export type MapFind = { id: string; title: string; lng: number; lat: number }

/** What the walker did, with where on the map it happened when that matters. */
export type EditorEdit =
  | { type: 'place-find'; at: LngLat }
  | { type: 'open-find'; findId: string }
  | { type: 'move-find'; findId: string; at: LngLat }
  | { type: 'append-point'; at: LngLat }
  | { type: 'select-point'; pointId: string }
  | { type: 'move-point'; pointId: string; at: LngLat }
  | { type: 'insert-point'; afterPointId: string; at: LngLat }
  | { type: 'delete-point'; pointId: string }

export type MapEditorProps = {
  tool: Tool
  route: readonly RoutePoint[]
  finds: readonly MapFind[]
  selectedPointId?: string | null
  openFindId?: string | null
  initialViewState: BaseMapProps['initialViewState']
  onMoveEnd?: BaseMapProps['onMoveEnd']
  onEdit: (edit: EditorEdit) => void
  /** Every gesture and what the rule made of it, for whoever wants to watch. */
  onGesture?: (tool: Tool, target: GestureTarget, gesture: Gesture, action: EditorAction) => void
  children?: ReactNode
}

/** A drag in progress: the map shows it live and the walk changes only when it ends. */
type Drag =
  | { type: 'move-find'; findId: string; at: LngLat }
  | { type: 'move-point'; pointId: string; at: LngLat }
  | { type: 'insert-point'; afterPointId: string; at: LngLat }

type DragAction = Extract<EditorAction, { type: Drag['type'] }>

const isDrag = (action: EditorAction): action is DragAction =>
  action.type === 'move-find' || action.type === 'move-point' || action.type === 'insert-point'

const INSERTING = 'inserting'

const routeWithDrag = (route: readonly RoutePoint[], drag: Drag | null): readonly RoutePoint[] => {
  if (drag?.type === 'move-point') return movePoint(route, drag.pointId, drag.at)
  if (drag?.type === 'insert-point') {
    return insertPointAfter(route, drag.afterPointId, { id: INSERTING, ...drag.at })
  }
  return route
}

// Where hit areas overlap, the higher layer takes the press: what the tool edits sits on top.
const layers = (tool: Tool) =>
  tool === 'route' ? { handle: 1, find: 2, point: 3 } : { handle: 1, point: 2, find: 3 }

/**
 * The map on the Walk screen. It reports each gesture to `resolveGesture` and applies the result
 * (web WEB-009): panning is left to the map, and every edit goes out through `onEdit`.
 */
export const MapEditor = ({
  tool,
  route,
  finds,
  selectedPointId,
  openFindId,
  initialViewState,
  onMoveEnd,
  onEdit,
  onGesture,
  children,
}: MapEditorProps) => {
  const [drag, setDrag] = useState<Drag | null>(null)
  // The action a drag resolved to when it started; it outlives the renders the drag causes.
  const dragAction = useRef<DragAction | null>(null)
  const shownRoute = routeWithDrag(route, drag)
  const layer = layers(tool)

  const resolve = (target: GestureTarget, gesture: Gesture) => {
    const action = resolveGesture(tool, target, gesture)
    onGesture?.(tool, target, gesture, action)
    return action
  }

  const applyTap = (action: EditorAction, at?: LngLat) => {
    switch (action.type) {
      case 'open-find':
      case 'select-point':
        onEdit(action)
        return
      case 'place-find':
      case 'append-point':
        if (at) onEdit({ type: action.type, at })
        return
      default:
        return
    }
  }

  const pressOn = (target: GestureTarget): MarkerPress => ({
    edits: dragEdits(tool, target),
    onTap: () => applyTap(resolve(target, 'tap')),
    onDeleteKey: () => {
      const action = resolve(target, 'delete-key')
      if (action.type !== 'delete-point') return false
      onEdit(action)
      return true
    },
    onDragStart: () => {
      const action = resolve(target, 'drag')
      dragAction.current = isDrag(action) ? action : null
    },
    onDrag: (at) => {
      if (dragAction.current) setDrag({ ...dragAction.current, at })
    },
    onDragEnd: (at) => {
      const action = dragAction.current
      dragAction.current = null
      setDrag(null)
      if (action) onEdit({ ...action, at })
    },
  })

  const onMapClick = (event: MapLayerMouseEvent) => {
    applyTap(resolve({ kind: 'map' }, 'tap'), { lng: event.lngLat.lng, lat: event.lngLat.lat })
  }

  // While a handle is dragged, the handles stay where the route was, so the dragged one stays put.
  const handles = midpoints(drag?.type === 'insert-point' ? route : shownRoute)

  return (
    <BaseMap
      initialViewState={initialViewState}
      onMoveEnd={onMoveEnd}
      onClick={onMapClick}
      doubleClickZoom={tool === 'view'}
      cursor={tool === 'view' ? 'grab' : 'crosshair'}
      style={{ width: '100%', height: '100%' }}
    >
      <RouteLine points={shownRoute} />
      {tool === 'route' &&
        handles.map(({ afterPointId, at }) => {
          const dragged = drag?.type === 'insert-point' && drag.afterPointId === afterPointId
          return (
            <MidpointHandle
              key={afterPointId}
              at={dragged ? drag.at : at}
              label="Insert a point here"
              press={pressOn({ kind: 'handle', afterPointId })}
              layer={layer.handle}
              dragging={dragged}
            />
          )
        })}
      {shownRoute
        .filter(({ id }) => id !== INSERTING)
        .map((point, index) => (
          <RoutePointMarker
            key={point.id}
            at={point}
            label={`Point ${index + 1}`}
            press={pressOn({ kind: 'point', pointId: point.id })}
            layer={layer.point}
            selected={point.id === selectedPointId}
            dragging={drag?.type === 'move-point' && drag.pointId === point.id}
          />
        ))}
      {finds.map((find) => {
        const dragged = drag?.type === 'move-find' && drag.findId === find.id
        return (
          <FindMarker
            key={find.id}
            at={dragged ? drag.at : find}
            title={find.title}
            press={pressOn({ kind: 'find', findId: find.id })}
            layer={layer.find}
            open={find.id === openFindId}
            dragging={dragged}
          />
        )
      })}
      {children}
    </BaseMap>
  )
}
