import { useEffect, useLayoutEffect, useRef } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { isTap } from './tap'

export type LngLat = { lng: number; lat: number }

export type MarkerPress = {
  /** Whether a drag that starts here edits. When false, the drag reaches the map and pans it. */
  edits: boolean
  onTap: () => void
  /** Delete or Backspace on the focused marker. Returns whether it deleted, to keep the key's usual meaning when not. */
  onDeleteKey?: () => boolean
  onDragStart?: () => void
  onDrag?: (at: LngLat) => void
  onDragEnd?: (at: LngLat) => void
}

/**
 * Turns presses on a marker into a tap or a drag, and decides who gets the drag.
 *
 * MapLibre pans on the `mousedown` and `touchstart` that bubble up to its canvas container, where
 * markers live. A marker whose drag edits stops them there, so the map never starts to pan; one
 * whose drag doesn't lets them through. The listeners are native because React's own run at the
 * root, after MapLibre has already seen the event.
 */
export const useMarkerPress = <T extends HTMLElement>(press: MarkerPress) => {
  const ref = useRef<T>(null)
  const latest = useRef(press)
  const { current: map } = useMap()

  useLayoutEffect(() => {
    latest.current = press
  })

  useEffect(() => {
    const element = ref.current
    if (!element || !map) return

    let active: { id: number; x: number; y: number; dragging: boolean; at: LngLat } | null = null

    const toLngLat = (event: PointerEvent): LngLat => {
      const box = map.getContainer().getBoundingClientRect()
      const { lng, lat } = map.unproject([event.clientX - box.left, event.clientY - box.top])
      return { lng, lat }
    }

    const keepFromMap = (event: Event) => {
      if (latest.current.edits) event.stopPropagation()
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return
      active = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        dragging: false,
        at: toLngLat(event),
      }
      if (latest.current.edits) {
        event.stopPropagation()
        element.setPointerCapture(event.pointerId)
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!active || event.pointerId !== active.id) return
      if (!active.dragging) {
        if (isTap(event.clientX - active.x, event.clientY - active.y)) return
        active.dragging = true
        if (latest.current.edits) latest.current.onDragStart?.()
      }
      if (!latest.current.edits) return
      active.at = toLngLat(event)
      latest.current.onDrag?.(active.at)
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!active || event.pointerId !== active.id) return
      const { dragging, at } = active
      active = null
      if (!dragging) latest.current.onTap()
      else if (latest.current.edits) latest.current.onDragEnd?.(at)
    }

    const onPointerCancel = (event: PointerEvent) => {
      if (!active || event.pointerId !== active.id) return
      const { dragging, at } = active
      active = null
      if (dragging && latest.current.edits) latest.current.onDragEnd?.(at)
    }

    // A tap on a marker is never a tap on the empty map. A click from the keyboard is a tap.
    const onClick = (event: MouseEvent) => {
      event.stopPropagation()
      if (event.detail === 0) latest.current.onTap()
    }
    const stop = (event: Event) => event.stopPropagation()

    const listeners: [string, EventListener][] = [
      ['pointerdown', onPointerDown as EventListener],
      ['pointermove', onPointerMove as EventListener],
      ['pointerup', onPointerUp as EventListener],
      ['pointercancel', onPointerCancel as EventListener],
      ['mousedown', keepFromMap],
      ['touchstart', keepFromMap],
      ['click', onClick as EventListener],
      ['dblclick', stop],
    ]
    for (const [type, listener] of listeners) element.addEventListener(type, listener)
    return () => {
      for (const [type, listener] of listeners) element.removeEventListener(type, listener)
    }
  }, [map])

  return ref
}
