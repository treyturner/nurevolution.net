import { expect, it } from 'vitest'
import { seekTarget } from '../../../app/services/player-seek'

it('clamps to duration and disjoint seekable ranges with earlier-point ties', () => {
  expect(seekTarget(-30, 40, [])).toBe(0)
  expect(seekTarget(50, 40, [])).toBe(40)
  expect(seekTarget(8.25, 40, [])).toBe(8.25)
  const ranges = [
    { start: 0, end: 10 },
    { start: 20, end: 40 },
  ]
  expect(seekTarget(8.25, 40, ranges)).toBe(8.25)
  expect(seekTarget(15, 40, ranges)).toBe(10)
  expect(seekTarget(16, 40, ranges)).toBe(20)
  expect(seekTarget(0, 40, [{ start: 5, end: 40 }])).toBe(5)
  expect(seekTarget(39, 30, [{ start: 50, end: 60 }])).toBe(30)
})
