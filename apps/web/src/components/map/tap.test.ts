import { describe, expect, test } from 'vitest'
import { isTap, TAP_TOLERANCE_PX } from './tap'

describe('isTap', () => {
  test('a press that stays within the tolerance is a tap', () => {
    expect(isTap(0, 0)).toBe(true)
    expect(isTap(TAP_TOLERANCE_PX, 0)).toBe(true)
  })

  test('a press that travels past it is a drag', () => {
    expect(isTap(TAP_TOLERANCE_PX, 1)).toBe(false)
    expect(isTap(-TAP_TOLERANCE_PX - 1, 0)).toBe(false)
  })
})
