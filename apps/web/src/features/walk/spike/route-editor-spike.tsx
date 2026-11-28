import { pointsInStretch, type RoutePoint } from '@wandr/sharing'
import { useCallback, useState } from 'react'
import type { ViewState } from 'react-map-gl/maplibre'
import { BaseMap } from '@/components/map/base-map'
import { RouteLine } from '@/components/map/route-line'
import { RoutePoint as RoutePointMarker } from '@/components/map/route-point'
import { StretchControls, type StretchEnd } from '@/components/map/stretch-controls'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { EditorTools } from '../editor-tools'
import { type EditorEdit, type MapFind, MapEditor } from '../map-editor'
import type { EditorAction, Gesture, GestureTarget, Tool } from '../resolve-gesture'
import { appendPoint, deletePoint, insertPointAfter, movePoint } from '../route-edits'

/*
 * The route editor spike (docs/04-flows.md §7): the real editor on local state, to try on a phone.
 * Nothing is saved. The Stretch mode stands in for Share's step 2 to try choosing ends by finger.
 */

type Mode = 'edit' | 'stretch'

const LAURELES: Pick<ViewState, 'longitude' | 'latitude' | 'zoom'> = {
  longitude: -75.5936,
  latitude: 6.2459,
  zoom: 16,
}

// IDs only need to be unique on this page. Not crypto.randomUUID(): it exists only in secure
// contexts, and a phone reaches the dev server over plain http on the local network.
let lastId = 0
const newId = () => `local-${++lastId}`

// Ten points about 60 px apart at zoom 16: a point and its handle sit about 30 px apart.
const sampleRoute = (center: { longitude: number; latitude: number }): RoutePoint[] =>
  Array.from({ length: 10 }, (_, index) => ({
    id: newId(),
    lng: center.longitude + (index - 4.5) * 0.0013,
    lat: center.latitude + (index % 2 === 0 ? 0.0004 : -0.0004),
  }))

const describe = (tool: Tool, target: GestureTarget, gesture: Gesture, action: EditorAction) =>
  `${tool} · ${gesture} on ${target.kind} → ${action.type}`

export const RouteEditorSpike = () => {
  const [mode, setMode] = useState<Mode>('edit')
  const [tool, setTool] = useState<Tool>('route')
  const [view, setView] = useState(LAURELES)
  const [route, setRoute] = useState<RoutePoint[]>([])
  const [finds, setFinds] = useState<MapFind[]>([])
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null)
  const [openFindId, setOpenFindId] = useState<string | null>(null)
  const [ends, setEnds] = useState<{ startId: string | null; endId: string | null }>({
    startId: null,
    endId: null,
  })
  const [log, setLog] = useState<{ id: string; line: string }[]>([])

  const note = useCallback(
    (line: string) => setLog((lines) => [{ id: newId(), line }, ...lines].slice(0, 6)),
    [],
  )

  const changeTool = useCallback((next: Tool) => {
    setTool(next)
    setSelectedPointId(null)
  }, [])

  const onEdit = (edit: EditorEdit) => {
    switch (edit.type) {
      case 'place-find': {
        const id = newId()
        setFinds((all) => [...all, { id, title: `Find ${all.length + 1}`, ...edit.at }])
        setOpenFindId(id)
        return
      }
      case 'open-find':
        setOpenFindId(edit.findId)
        return
      case 'move-find':
        setFinds((all) =>
          all.map((find) => (find.id === edit.findId ? { ...find, ...edit.at } : find)),
        )
        return
      case 'append-point':
        setRoute((points) => appendPoint(points, { id: newId(), ...edit.at }))
        setSelectedPointId(null)
        return
      case 'select-point':
        setSelectedPointId((current) => (current === edit.pointId ? null : edit.pointId))
        return
      case 'move-point':
        setRoute((points) => movePoint(points, edit.pointId, edit.at))
        return
      case 'delete-point':
        setRoute((points) => deletePoint(points, edit.pointId))
        setSelectedPointId(null)
        return
      case 'insert-point':
        setRoute((points) =>
          insertPointAfter(points, edit.afterPointId, { id: newId(), ...edit.at }),
        )
        return
    }
  }

  const pointNumber = (id: string | null) => {
    const index = route.findIndex((point) => point.id === id)
    return index === -1 ? null : index
  }
  const start = pointNumber(ends.startId)
  const end = pointNumber(ends.endId)
  const stretch =
    ends.startId && ends.endId
      ? pointsInStretch(route, { startId: ends.startId, endId: ends.endId })
      : []

  // A tap sets the start, then the end; a third tap starts over.
  const tapEnd = (pointId: string) =>
    setEnds((current) =>
      current.startId && !current.endId
        ? { ...current, endId: pointId }
        : { startId: pointId, endId: null },
    )

  const moveEnd = (which: StretchEnd, index: number) => {
    const point = route[index]
    if (!point) return
    setEnds((current) =>
      which === 'start' ? { ...current, startId: point.id } : { ...current, endId: point.id },
    )
  }

  const openFind = finds.find((find) => find.id === openFindId)

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b bg-background p-2">
        <ToggleGroup
          type="single"
          aria-label="Spike mode"
          value={mode}
          onValueChange={(value) => {
            if (value === 'edit' || value === 'stretch') setMode(value)
          }}
        >
          <ToggleGroupItem value="edit">Edit</ToggleGroupItem>
          <ToggleGroupItem value="stretch">Stretch</ToggleGroupItem>
        </ToggleGroup>
        {mode === 'edit' && <EditorTools tool={tool} onChange={changeTool} />}
      </header>

      <div className="relative min-h-0 flex-1">
        {mode === 'edit' ? (
          <MapEditor
            tool={tool}
            route={route}
            finds={finds}
            selectedPointId={selectedPointId}
            openFindId={openFindId}
            initialViewState={view}
            onMoveEnd={(event) => setView(event.viewState)}
            onEdit={onEdit}
            onGesture={(...gesture) => note(describe(...gesture))}
          />
        ) : (
          <BaseMap
            initialViewState={view}
            onMoveEnd={(event) => setView(event.viewState)}
            style={{ width: '100%', height: '100%' }}
          >
            <RouteLine points={route} stretch={stretch} />
            {route.map((point, index) => (
              <RoutePointMarker
                key={point.id}
                at={point}
                label={`Point ${index + 1}`}
                press={{ edits: false, onTap: () => tapEnd(point.id) }}
                layer={1}
                selected={point.id === ends.startId || point.id === ends.endId}
              />
            ))}
          </BaseMap>
        )}
      </div>

      <section
        aria-label="Spike controls"
        className="flex max-h-[45dvh] flex-col gap-3 overflow-y-auto border-t bg-card p-4"
      >
        {mode === 'edit' ? (
          <div className="flex flex-wrap gap-2">
            {selectedPointId && (
              <Button
                variant="destructive"
                onClick={() => {
                  setRoute((points) => deletePoint(points, selectedPointId))
                  setSelectedPointId(null)
                }}
              >
                Delete point
              </Button>
            )}
            {openFind && (
              <>
                <span className="type-label self-center">{openFind.title}</span>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setFinds((all) => all.filter((find) => find.id !== openFind.id))
                    setOpenFindId(null)
                  }}
                >
                  Delete find
                </Button>
                <Button variant="outline" onClick={() => setOpenFindId(null)}>
                  Close
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setRoute(sampleRoute(view))}>
              Sample route
            </Button>
            <Button
              variant="outline"
              disabled={route.length === 0}
              onClick={() => {
                setRoute([])
                setSelectedPointId(null)
              }}
            >
              Clear route
            </Button>
          </div>
        ) : (
          <StretchControls total={route.length} start={start} end={end} onMove={moveEnd} />
        )}
        <ol
          aria-label="Last gestures"
          className="type-meta-lg flex flex-col gap-1 text-muted-foreground"
        >
          {log.map(({ id, line }) => (
            <li key={id}>{line}</li>
          ))}
        </ol>
      </section>
    </div>
  )
}
