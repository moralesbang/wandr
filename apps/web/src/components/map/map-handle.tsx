import type { ReactNode } from 'react'
import { Marker } from 'react-map-gl/maplibre'
import { cn } from '@/lib/utils'
import { type LngLat, type MarkerPress, useMarkerPress } from './use-marker-press'

export type MapHandleProps = {
  at: LngLat
  label: string
  press: MarkerPress
  /** Stacking among overlays: where hit areas overlap, the higher one takes the press. */
  layer: number
  pressed?: boolean
  children: ReactNode
}

/**
 * Something on the map a walker can press: a 44 × 44 px hit area around a smaller mark
 * (web WEB-008). A drag that edits needs `touch-none`, or the browser scrolls instead.
 */
export const MapHandle = ({ at, label, press, layer, pressed, children }: MapHandleProps) => {
  const ref = useMarkerPress<HTMLButtonElement>(press)
  return (
    <Marker longitude={at.lng} latitude={at.lat} style={{ zIndex: layer }}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onKeyDown={(event) => {
          if (event.key !== 'Delete' && event.key !== 'Backspace') return
          if (press.onDeleteKey?.()) event.preventDefault()
        }}
        className={cn(
          'flex size-touch items-center justify-center rounded-full',
          press.edits ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer',
        )}
      >
        {children}
      </button>
    </Marker>
  )
}
