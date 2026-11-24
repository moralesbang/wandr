import { cn } from '@/lib/utils'
import { MapHandle } from './map-handle'
import type { LngLat, MarkerPress } from './use-marker-press'

export type FindMarkerProps = {
  at: LngLat
  title: string
  press: MarkerPress
  layer: number
  open?: boolean
  dragging?: boolean
}

export const FindMarker = ({ at, title, press, layer, open, dragging }: FindMarkerProps) => (
  <MapHandle at={at} label={title} press={press} layer={layer} pressed={open}>
    <span
      className={cn(
        'size-6 rounded-full border-2 border-find-foreground bg-find shadow-map-marker transition-transform duration-(--duration-fast)',
        open && 'ring-2 ring-map-selected ring-offset-1 ring-offset-find-foreground',
        dragging && 'scale-125 shadow-map-drag',
      )}
    />
  </MapHandle>
)
