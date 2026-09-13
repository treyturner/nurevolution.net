import { describe, expect, it, vi } from 'vitest'
import {
  createPlaybackStorage,
  parseResume,
  resumeKey,
  visitKey,
  visitWindow,
} from '../../../app/services/playback-storage'
function setup() {
  let now = 100_000_000
  const data = new Map<string, string>()
  const port = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key)
    }),
  }
  const store = createPlaybackStorage(
    () => port,
    () => now,
  )
  return {
    store,
    port,
    data,
    at: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}
const saved = (now: number) => ({
  schemaVersion: 1,
  episodeId: 'wp-417',
  positionSeconds: 8.25,
  updatedAt: now,
})

describe('one-slot local playback persistence', () => {
  it.each([visitWindow - 1, visitWindow, visitWindow + 1])(
    'expires from the previous visit at %i ms, before recording this visit',
    (elapsed) => {
      const { store, port, at, advance } = setup()
      expect(store.visit()).toBeNull()
      store.capture('wp-417', 8.25, true)
      const original = saved(at())
      advance(elapsed)
      expect(store.visit()).toEqual(elapsed < visitWindow ? original : null)
      expect(JSON.parse(port.getItem(visitKey)!)).toEqual({
        schemaVersion: 1,
        lastVisitedAt: at(),
      })
    },
  )
  it('separates visits from progress writes and does not expire an active session', () => {
    const { store, port, advance } = setup()
    store.visit()
    const visit = port.getItem(visitKey)
    advance(visitWindow + 1)
    store.capture('wp-417', 20, true)
    expect(port.getItem(visitKey)).toBe(visit)
    expect(JSON.parse(port.getItem(resumeKey)!).positionSeconds).toBe(20)
    expect(store.visit()).toBeNull()
  })
  it('extends the visit window for a document return without reapplying/removing its live state', () => {
    const { store, port, advance } = setup()
    store.visit()
    store.capture('wp-417', 1.5, true)
    const record = port.getItem(resumeKey)
    advance(visitWindow)
    expect(store.visit(false)).toBeNull()
    expect(port.getItem(resumeKey)).toBe(record)
    expect(store.visit()).toMatchObject({ positionSeconds: 1.5 })
  })
  it('throttles active progress and flushes only dirty records, retaining activity time', () => {
    const { store, port, at, advance } = setup()
    store.visit()
    store.capture('wp-417', 0, true)
    port.setItem.mockClear()
    advance(1000)
    store.capture('wp-417', 1)
    expect(port.setItem).not.toHaveBeenCalled()
    const activityAt = at()
    advance(1000)
    store.flush()
    expect(JSON.parse(port.getItem(resumeKey)!)).toMatchObject({
      updatedAt: activityAt,
      positionSeconds: 1,
    })
    port.setItem.mockClear()
    store.flush()
    expect(port.setItem).not.toHaveBeenCalled()
    advance(5000)
    store.capture('wp-417', 7)
    expect(port.setItem).toHaveBeenCalledOnce()
  })
  it('does not let a delayed stale-tab flush overwrite newer activity, and allows equal-time last writes', () => {
    const { store, port, at, advance } = setup()
    const other = createPlaybackStorage(() => port, at)
    store.visit()
    store.capture('wp-417', 0, true)
    advance(1)
    store.capture('wp-417', 1)
    advance(1)
    other.capture('wp-484', 5, true)
    store.flush()
    expect(JSON.parse(port.getItem(resumeKey)!).episodeId).toBe('wp-484')
    store.capture('wp-417', 2, true)
    expect(JSON.parse(port.getItem(resumeKey)!).episodeId).toBe('wp-417')
  })
  it.each([null, '', '[1]', '{', 'x'.repeat(2049), 'null', '2', '{}'])(
    'ignores malformed records: %s',
    (value) => {
      expect(parseResume(value, 1000)).toBeNull()
    },
  )
  it('rejects unknown schemas, unexpected fields, invalid identities/positions and future activity', () => {
    for (const change of [
      { schemaVersion: 2 },
      { extra: true },
      { episodeId: '' },
      { episodeId: '../bad' },
      { positionSeconds: -1 },
      { positionSeconds: null },
      { positionSeconds: '1' },
      { updatedAt: 1001 },
      { updatedAt: -1 },
    ])
      expect(
        parseResume(JSON.stringify({ ...saved(1000), ...change }), 1000),
      ).toBeNull()
    expect(parseResume(JSON.stringify(saved(1000)), 1000)).toEqual(saved(1000))
  })
  it.each([
    {},
    { schemaVersion: 2, lastVisitedAt: 0 },
    { schemaVersion: 1, lastVisitedAt: 100_000_001 },
    { schemaVersion: 1, lastVisitedAt: -1 },
    { schemaVersion: 1, lastVisitedAt: 100_000_000, extra: true },
  ])('rejects invalid visit state independently of valid progress', (visit) => {
    const { store, data, at } = setup()
    data.set(visitKey, JSON.stringify(visit))
    data.set(resumeKey, JSON.stringify(saved(at())))
    expect(store.visit()).toBeNull()
    expect(data.has(resumeKey)).toBe(false)
  })
  it('discards only its own resume key and ignores invalid capture positions', () => {
    const { store, port, data } = setup()
    store.visit()
    data.set('unrelated', 'keep')
    for (const position of [NaN, Infinity, -1])
      store.capture('wp-417', position, true)
    expect(data.has(resumeKey)).toBe(false)
    store.capture('wp-417', 1, true)
    store.discard()
    expect(port.getItem(resumeKey)).toBeNull()
    expect(data.get('unrelated')).toBe('keep')
  })
  it.each(['getItem', 'setItem', 'removeItem'] as const)(
    'contains %s exceptions and disables future persistence',
    (method) => {
      const { store, port } = setup()
      port[method].mockImplementation(() => {
        throw new Error('unavailable')
      })
      expect(() => store.visit()).not.toThrow()
      store.capture('wp-417', 1, true)
      store.discard()
      store.flush()
      expect(port[method]).toHaveBeenCalledOnce()
    },
  )
  it('contains an exception accessing the storage property itself', () => {
    const access = vi.fn(() => {
      throw new Error('blocked')
    })
    const store = createPlaybackStorage(access)
    expect(store.visit()).toBeNull()
    store.capture('wp-417', 10, true)
    expect(access).toHaveBeenCalledOnce()
  })
})
