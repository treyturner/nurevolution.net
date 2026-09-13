import { expect, it } from 'vitest'
import { trackNavigation } from '../../../app/services/track-navigation'
const tracks = (starts: (number | null)[]) =>
  starts.map((startTime, i) => ({
    position: i + 1,
    artist: 'Artist',
    title: `Track ${i + 1}`,
    startTime,
  }))
it('uses exact fractional three-second boundaries and never wraps tracks', () => {
  const source = tracks([0, 8.25, 32])
  for (const [time, previous, next, current] of [
    [0, 0, 8.25, 1],
    [8.249, 0, 8.25, 1],
    [8.25, 0, 32, 2],
    [11.249, 0, 32, 2],
    [11.25, 0, 32, 2],
    [11.251, 8.25, 32, 2],
    [32, 8.25, null, 3],
    [35, 8.25, null, 3],
    [35.001, 32, null, 3],
    [40, 32, null, 3],
  ])
    expect(trackNavigation(source, time!, 40)).toMatchObject({
      previous,
      next,
      current,
    })
})
it('does not invent a track before the first start or across an untimed boundary', () => {
  const source = tracks([4, null, 8.25, 32, null])
  expect(trackNavigation(source, 0, null)).toEqual({
    previous: null,
    next: 4,
    current: null,
    positions: [1, 3, 4],
  })
  expect(trackNavigation(source, 5, 40)).toMatchObject({
    previous: 4,
    next: 8.25,
    current: null,
  })
  expect(trackNavigation(source, 8.25, 40)).toMatchObject({
    previous: 4,
    next: 32,
    current: 3,
  })
  expect(trackNavigation(source, 32, 40)).toMatchObject({
    previous: 8.25,
    next: null,
    current: null,
  })
})
it('retains only usable starts as actual duration changes, including a lone timed final row', () => {
  const source = tracks([null, 8.25, 32, 40])
  expect(trackNavigation(source, 12, 32)).toEqual({
    previous: 8.25,
    next: null,
    current: 2,
    positions: [2],
  })
  expect(trackNavigation(source, 40, 50).current).toBe(4)
  for (const source of [[], tracks([null, null]), tracks([Infinity, NaN, -1])])
    expect(trackNavigation(source, 0, 40)).toEqual({
      previous: null,
      next: null,
      current: null,
      positions: [],
    })
})
