import { cn } from '@/lib/utils'
import { MapHandle } from './map-handle'
import type { LngLat, MarkerPress } from './use-marker-press'

export type MidpointHandleProps = {
  at: LngLat
  label: string
  press: MarkerPress
  layer: number
  dragging?: boolean
}

/** Halfway between two route points; dragging it inserts a point there. */
export const MidpointHandle = ({ at, label, press, layer, dragging }: MidpointHandleProps) => (
  <MapHandle at={at} label={label} press={press} layer={layer}>
    <span
      className={cn(
        'size-2.5 rounded-full border-2 border-route-point bg-route-handle transition-transform duration-(--duration-fast)',
        dragging && 'scale-150 shadow-map-drag',
      )}
    />
  </MapHandle>
)
