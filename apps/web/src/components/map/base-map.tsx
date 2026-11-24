import 'maplibre-gl/dist/maplibre-gl.css'
import { setWorkerUrl } from 'maplibre-gl'
import workerSource from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw'
import { useMemo } from 'react'
import { Map, type MapProps } from 'react-map-gl/maplibre'
import { buildMapStyle } from '@/lib/map-style'
import { TAP_TOLERANCE_PX } from './tap'
import { useMapTokens } from './use-map-tokens'

// MapLibre looks for its worker file next to its own, which Vite moves. Vite's dev server also
// rewrites every module it serves, and a rewritten worker fails to start. The worker is one
// self-contained file, so it ships as text in this chunk and starts from a Blob, the same way in
// development and in production.
setWorkerUrl(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })))

export type BaseMapProps = Omit<MapProps, 'mapStyle' | 'clickTolerance'>

/** Wandr's map: our own style from the tokens, following light and dark mode without losing the view. */
export const BaseMap = ({ children, ...props }: BaseMapProps) => {
  const tokens = useMapTokens()
  const mapStyle = useMemo(() => buildMapStyle(tokens), [tokens])
  return (
    <Map
      mapStyle={mapStyle}
      clickTolerance={TAP_TOLERANCE_PX}
      dragRotate={false}
      pitchWithRotate={false}
      touchPitch={false}
      {...props}
    >
      {children}
    </Map>
  )
}
