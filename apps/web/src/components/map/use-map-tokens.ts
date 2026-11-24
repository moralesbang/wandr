import { useSyncExternalStore } from 'react'
import { type MapTokens, mapTokenNames } from '@/lib/map-style'

const DARK = '(prefers-color-scheme: dark)'

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(DARK)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

// One reading per colour scheme, so the snapshot stays the same object until the scheme changes.
const readings = new Map<boolean, MapTokens>()

const read = (): MapTokens => {
  const dark = window.matchMedia(DARK).matches
  const cached = readings.get(dark)
  if (cached) return cached
  const style = getComputedStyle(document.documentElement)
  const tokens = Object.fromEntries(
    mapTokenNames.map((name) => [name, style.getPropertyValue(`--${name}`).trim()]),
  ) as MapTokens
  readings.set(dark, tokens)
  return tokens
}

/** The map's colours from the Design System's tokens, read again when light or dark mode changes. */
export const useMapTokens = (): MapTokens => useSyncExternalStore(subscribe, read)
