import { expect, it } from 'vitest'
import { createTrackClock } from '../../../app/services/track-clock'
import type { PlayerSnapshot } from '../../../app/services/player'

const state = (): PlayerSnapshot => ({
  sourceId: 'episode',
  status: 'paused',
  wantsPlay: false,
  currentTime: 357.514467,
  duration: 3600,
  seeking: false,
  pendingSeek: null,
  seekMessage: null,
  volume: 1,
  muted: false,
  volumeSupported: true,
  muteSupported: true,
})

it('holds the confirmed track boundary during the captured Safari rollback without changing the media clock', () => {
  let now = 0
  const clock = createTrackClock(() => now)
  const s = state()
  expect(clock(s, 'seeked')).toBe(357.514467)
  now = 60_000 // A paused seek may wait before the listener presses Play.
  s.status = 'playing'
  s.wantsPlay = true
  expect(clock(s, 'playing')).toBe(357.514467)
  s.currentTime = 357.344128849
  expect(clock(s, 'timeupdate')).toBe(357.514467)
  expect(s.currentTime).toBe(357.344128849)
  now += 250
  s.currentTime = 357.596735216
  expect(clock(s, 'timeupdate')).toBe(s.currentTime)
  s.currentTime = 357.4
  expect(clock(s, 'timeupdate')).toBe(357.4)
})

it('expires the grace period, rejects larger jumps, and does not widen natural track boundaries', () => {
  let now = 0
  const clock = createTrackClock(() => now)
  const s = state()
  expect(clock(s, 'timeupdate')).toBe(s.currentTime)
  clock(s, 'seeked')
  s.wantsPlay = true
  s.currentTime -= 0.3
  expect(clock(s, 'timeupdate')).toBe(357.514467)
  now = 1000
  expect(clock(s, 'timeupdate')).toBe(s.currentTime)
  clock(s, 'seeked')
  s.currentTime -= 0.6
  expect(clock(s, 'timeupdate')).toBe(s.currentTime)
})

it('honors a new explicit seek even before the browser dispatches seeking', () => {
  const clock = createTrackClock()
  const s = state()
  clock(s, 'seeked')
  clock.reset()
  s.currentTime -= 0.1
  expect(clock(s)).toBe(s.currentTime)
})

it.each(['source', 'pending', 'seeking', 'loading', 'error'] as const)(
  'releases an old anchor on %s and honors deliberate backward seeks',
  (change) => {
    const clock = createTrackClock()
    const s = state()
    clock(s, 'seeked')
    s.currentTime -= 0.2
    if (change === 'source') s.sourceId = 'other'
    if (change === 'pending') s.pendingSeek = s.currentTime
    if (change === 'seeking') s.seeking = true
    if (change === 'loading' || change === 'error') s.status = change
    expect(clock(s, 'timeupdate')).toBe(s.currentTime)
    s.pendingSeek = null
    s.seeking = false
    s.status = 'paused'
    expect(clock(s, 'seeked')).toBe(s.currentTime)
  },
)
