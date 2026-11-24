/** One point of a walk's route. Its ID survives route edits; its order is its place in the array. */
export type RoutePoint = {
  id: string
  lat: number
  lng: number
}

/** The two points that bound a link's stretch, by ID, in any order. */
export type StretchEnds = {
  startId: string
  endId: string
}

/**
 * The route points a link shows: those from one end to the other, both included, in route order.
 * A stretch needs two distinct points on the route; anything else shows no route.
 */
export const pointsInStretch = (route: readonly RoutePoint[], ends: StretchEnds): RoutePoint[] => {
  const start = route.findIndex((point) => point.id === ends.startId)
  const end = route.findIndex((point) => point.id === ends.endId)
  if (start === -1 || end === -1 || start === end) return []
  return route.slice(Math.min(start, end), Math.max(start, end) + 1)
}
