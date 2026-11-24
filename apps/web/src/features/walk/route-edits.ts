import type { RoutePoint } from '@wandr/sharing'

type At = { lng: number; lat: number }

/** Route edits as pure functions: each returns a new route, and every point keeps its ID. */

export const appendPoint = (route: readonly RoutePoint[], point: RoutePoint): RoutePoint[] => [
  ...route,
  point,
]

export const insertPointAfter = (
  route: readonly RoutePoint[],
  afterPointId: string,
  point: RoutePoint,
): RoutePoint[] => {
  const index = route.findIndex(({ id }) => id === afterPointId)
  if (index === -1) return [...route]
  return [...route.slice(0, index + 1), point, ...route.slice(index + 1)]
}

export const movePoint = (route: readonly RoutePoint[], pointId: string, at: At): RoutePoint[] =>
  route.map((point) => (point.id === pointId ? { ...point, lng: at.lng, lat: at.lat } : point))

export const deletePoint = (route: readonly RoutePoint[], pointId: string): RoutePoint[] =>
  route.filter(({ id }) => id !== pointId)

/** Halfway between each point and the next, where a drag inserts a point. */
export const midpoints = (route: readonly RoutePoint[]): { afterPointId: string; at: At }[] =>
  route.slice(1).flatMap((next, index) => {
    const previous = route[index]
    if (!previous) return []
    return [
      {
        afterPointId: previous.id,
        at: { lng: (previous.lng + next.lng) / 2, lat: (previous.lat + next.lat) / 2 },
      },
    ]
  })
