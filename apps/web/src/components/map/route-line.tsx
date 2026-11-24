import type { GeoJSONSourceSpecification } from 'maplibre-gl'
import { Layer, Source } from 'react-map-gl/maplibre'
import type { LngLat } from './use-marker-press'
import { useMapTokens } from './use-map-tokens'

export type RouteLineProps = {
  points: readonly LngLat[]
  /** The part of the route on the walk's link, drawn as a band under it. */
  stretch?: readonly LngLat[]
}

const line = (points: readonly LngLat[]): GeoJSONSourceSpecification['data'] => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: points.map(({ lng, lat }) => [lng, lat]) },
})

/** The route as map layers, under every marker (web WEB-008). */
export const RouteLine = ({ points, stretch = [] }: RouteLineProps) => {
  const tokens = useMapTokens()
  return (
    <>
      <Source id="stretch" type="geojson" data={line(stretch)}>
        <Layer
          id="stretch-band"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': tokens['link-band'], 'line-width': 18 }}
        />
      </Source>
      <Source id="route" type="geojson" data={line(points)}>
        <Layer
          id="route-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': tokens['route-casing'], 'line-width': 7 }}
        />
        <Layer
          id="route"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': tokens.route, 'line-width': 4 }}
        />
      </Source>
    </>
  )
}
