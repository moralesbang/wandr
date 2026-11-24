/**
 * How far a press may travel, in CSS pixels, and still count as a tap. The markers and the map's
 * own click tolerance share it, so a tap means the same on a marker and on the empty map.
 */
export const TAP_TOLERANCE_PX = 8

export const isTap = (dx: number, dy: number): boolean => Math.hypot(dx, dy) <= TAP_TOLERANCE_PX
