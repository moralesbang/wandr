import type { KeyboardEventHandler } from 'react'
import { cn } from '@/lib/utils'
import { MapHandle } from './map-handle'
import type { LngLat, MarkerPress } from './use-marker-press'

export type RoutePointProps = {
  at: LngLat
  label: string
  press: MarkerPress
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>
  layer: number
  selected?: boolean
  dragging?: boolean
}

export const RoutePoint = ({
  at,
  label,
  press,
  onKeyDown,
  layer,
  selected,
  dragging,
}: RoutePointProps) => (
  <MapHandle
    at={at}
    label={label}
    press={press}
    onKeyDown={onKeyDown}
    layer={layer}
    pressed={selected}
  >
    <span
      className={cn(
        'size-3.5 rounded-full border-[3px] border-route bg-route-point shadow-map-marker transition-transform duration-(--duration-fast)',
        selected && 'border-map-selected bg-map-selected',
        dragging && 'scale-150 shadow-map-drag',
      )}
    />
  </MapHandle>
)
