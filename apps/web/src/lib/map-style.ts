import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'

/**
 * The colours a map style is built from: the Design System's `map-*` and route tokens, read from
 * the theme at runtime so the map switches with light and dark mode (docs/05-architecture.md §10).
 */
export const mapTokenNames = [
  'map-land',
  'map-water',
  'map-park',
  'map-building',
  'map-road',
  'map-road-casing',
  'map-label',
  'route',
  'route-casing',
  'link-band',
  'background',
] as const

export type MapTokens = Record<(typeof mapTokenNames)[number], string>

const TILES = 'https://tiles.openfreemap.org/planet'
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
const FONT = ['Noto Sans Regular']
const NAME: ExpressionSpecification = ['coalesce', ['get', 'name_en'], ['get', 'name']]

const MINOR_ROADS = ['minor', 'service', 'track']
const MAJOR_ROADS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']

/**
 * Road width by zoom, major roads wider: thin from afar, a street a walker recognises at
 * neighbourhood zoom. MapLibre takes zoom only at the top of an expression, so the class is
 * matched at each stop.
 */
const roadWidth = (major: [number, number], minor: [number, number]): ExpressionSpecification => {
  const byClass = (scale: number): ExpressionSpecification => [
    'match',
    ['get', 'class'],
    MAJOR_ROADS,
    major[0] * scale,
    minor[0] * scale,
  ]
  return [
    'interpolate',
    ['exponential', 1.6],
    ['zoom'],
    12,
    byClass(1 / 3),
    14,
    byClass(1),
    18,
    ['match', ['get', 'class'], MAJOR_ROADS, major[1], minor[1]],
  ]
}

/** Wandr's base map over OpenFreeMap's OpenMapTiles schema, quiet so the walk reads on top. */
export const buildMapStyle = (tokens: MapTokens): StyleSpecification => ({
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: TILES } },
  glyphs: GLYPHS,
  layers: [
    { id: 'land', type: 'background', paint: { 'background-color': tokens['map-land'] } },
    {
      id: 'park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      paint: { 'fill-color': tokens['map-park'] },
    },
    {
      id: 'landcover-green',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood']]],
      paint: { 'fill-color': tokens['map-park'] },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': tokens['map-water'] },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      paint: { 'line-color': tokens['map-water'], 'line-width': 1.5 },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 14,
      paint: { 'fill-color': tokens['map-building'] },
    },
    {
      id: 'path',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 15,
      filter: ['==', ['get', 'class'], 'path'],
      paint: {
        'line-color': tokens['map-road-casing'],
        'line-width': 1,
        'line-dasharray': [2, 2],
      },
    },
    {
      id: 'road-casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', [...MINOR_ROADS, ...MAJOR_ROADS]]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': tokens['map-road-casing'],
        'line-width': roadWidth([5, 22], [3, 14]),
      },
    },
    {
      id: 'road',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', [...MINOR_ROADS, ...MAJOR_ROADS]]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': tokens['map-road'],
        'line-width': roadWidth([3.5, 18], [2, 11]),
      },
    },
    {
      id: 'water-name',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 12 },
      paint: { 'text-color': tokens['map-label'] },
    },
    {
      id: 'road-name',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 15,
      layout: {
        'symbol-placement': 'line',
        'text-field': NAME,
        'text-font': FONT,
        'text-size': 12,
      },
      paint: {
        'text-color': tokens['map-label'],
        'text-halo-color': tokens['map-road'],
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'place-name',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      layout: {
        'text-field': NAME,
        'text-font': FONT,
        'text-size': ['match', ['get', 'class'], ['city', 'town'], 15, 13],
      },
      paint: {
        'text-color': tokens['map-label'],
        'text-halo-color': tokens['map-land'],
        'text-halo-width': 1.5,
      },
    },
  ],
})
