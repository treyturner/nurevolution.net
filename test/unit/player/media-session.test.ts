import { expect, it, vi } from 'vitest'
import {
  createMediaSession,
  type MediaSessionSnapshot,
  type MediaSessionPort,
} from '../../../app/services/media-session'
import { episodeDetail } from '../../../shared/content/public'
import { archiveCatalog } from '../../fixtures/archive'

function harness() {
  const episode = episodeDetail(
    archiveCatalog,
    archiveCatalog.episodes.find((e) => e.id === 'wp-484')!,
  )
  const state: MediaSessionSnapshot = {
    episode,
    showTitle: 'nurevolution studios',
    artworkUrl: 'https://dev-web.example.test/ruminate.jpg',
    busy: false,
    track: 1,
    previous: 0,
    next: episode.tracks[1]!.startTime,
    sourceId: episode.id,
    status: 'paused',
    wantsPlay: false,
    currentTime: 12.25,
    duration: 3610,
    seeking: false,
    pendingSeek: null,
    seekMessage: null,
    volume: 1,
    muted: false,
    volumeSupported: true,
    muteSupported: true,
  }
  const handlers = new Map<
    MediaSessionAction,
    MediaSessionActionHandler | null
  >()
  const session: MediaSessionPort = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: vi.fn((action, callback) => {
      handlers.set(action, callback)
    }),
    setPositionState: vi.fn(),
  }
  const host = {
    snapshot: () => state,
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    skip: vi.fn(),
    previousTrack: vi.fn(),
    nextTrack: vi.fn(),
  }
  const metadata = vi.fn((value: MediaMetadataInit) => value as MediaMetadata)
  let now = 0
  const adapter = createMediaSession(session, metadata, host, () => now)
  adapter.update()
  return {
    state,
    session,
    handlers,
    host,
    metadata,
    adapter,
    advance: (ms: number) => {
      now += ms
    },
  }
}

it('routes system controls through the player with exact seek targets and default offsets', () => {
  const h = harness()
  for (const action of [
    'play',
    'pause',
    'stop',
    'previoustrack',
    'nexttrack',
  ] as const)
    h.handlers.get(action)!({ action })
  expect(h.host.play).toHaveBeenCalledOnce()
  expect(h.host.pause).toHaveBeenCalledTimes(2)
  expect(h.host.previousTrack).toHaveBeenCalledOnce()
  expect(h.host.nextTrack).toHaveBeenCalledOnce()
  const target = 7695011 / 44100
  h.handlers.get('seekto')!({
    action: 'seekto',
    seekTime: target,
    fastSeek: true,
  })
  h.handlers.get('seekto')!({ action: 'seekto', seekTime: -5 })
  for (const seekTime of [undefined, NaN, Infinity])
    h.handlers.get('seekto')!({ action: 'seekto', seekTime })
  expect(h.host.seek.mock.calls).toEqual([[target], [-5]])
  for (const action of ['seekbackward', 'seekforward'] as const) {
    for (const seekOffset of [undefined, 0, -3, NaN, Infinity, 12.25])
      h.handlers.get(action)!({ action, seekOffset })
  }
  expect(h.host.skip.mock.calls).toEqual(
    [-30, -30, -30, -30, -30, -12.25, 30, 30, 30, 30, 30, 12.25].map(
      (value) => [value],
    ),
  )
})

it('disables unavailable actions and makes retained callbacks check the current source and boundaries', () => {
  const h = harness()
  const next = h.handlers.get('nexttrack')!
  h.state.next = null
  next({ action: 'nexttrack' })
  expect(h.host.nextTrack).not.toHaveBeenCalled()
  h.adapter.update()
  expect(h.handlers.get('nexttrack')).toBeNull()
  h.state.next = 400
  h.state.previous = null
  h.adapter.update()
  expect(h.handlers.get('previoustrack')).toBeNull()
  next({ action: 'nexttrack' })
  expect(h.host.nextTrack).toHaveBeenCalledOnce()
  for (const condition of ['busy', 'error', 'source'] as const) {
    h.state.busy = condition === 'busy'
    h.state.status = condition === 'error' ? 'error' : 'paused'
    h.state.sourceId =
      condition === 'source' ? 'different-episode' : h.state.episode!.id
    h.adapter.update()
    for (const action of ['play', 'seekto', 'nexttrack'])
      expect(h.handlers.get(action as MediaSessionAction)).toBeNull()
    expect(h.handlers.get('pause')).toBeTypeOf('function')
    next({ action: 'nexttrack' })
  }
  expect(h.host.nextTrack).toHaveBeenCalledOnce()
  h.state.sourceId = null
  h.adapter.update()
  expect([...h.handlers.values()].every((handler) => handler === null)).toBe(
    true,
  )
  expect(h.session.playbackState).toBe('none')
  expect(h.session.metadata).toBeNull()
})

it('uses current track or episode metadata and updates identity only when values change', () => {
  const h = harness()
  expect(h.session.metadata).toEqual({
    title: 'Troglodyte',
    artist: 'Mat Zo',
    album: 'Trey Turner - Ruminate',
    artwork: [{ src: h.state.artworkUrl }],
  })
  h.state.currentTime++
  h.adapter.update()
  expect(h.metadata).toHaveBeenCalledOnce()
  h.state.track = 2
  h.adapter.update()
  expect(h.session.metadata!.title).toBe(h.state.episode!.tracks[1]!.title)
  h.state.track = null
  h.adapter.update()
  expect(h.session.metadata).toMatchObject({
    title: 'Ruminate',
    artist: 'Trey Turner',
    album: 'nurevolution studios',
  })
  h.state.artworkUrl = ''
  h.adapter.update()
  expect(h.session.metadata!.artwork).toEqual([])
  h.state.episode = {
    ...h.state.episode!,
    id: 'other',
    title: 'Other episode',
    tracks: [],
  }
  h.state.sourceId = 'other'
  h.adapter.update()
  expect(h.session.metadata!.title).toBe('Other episode')
})

it('replaces track metadata without briefly publishing a generic fallback', () => {
  const h = harness()
  let current = h.session.metadata
  const writes: (string | null)[] = []
  Object.defineProperty(h.session, 'metadata', {
    get: () => current,
    set: (value: MediaMetadata | null) => {
      writes.push(value?.title ?? null)
      current = value
    },
  })
  h.state.track = 2
  h.adapter.update()
  h.state.currentTime++
  h.adapter.update()
  expect(writes).toEqual([h.state.episode!.tracks[1]!.title])
})

it('clears stale identity when constructing or assigning replacement metadata fails', () => {
  for (const failure of ['constructor', 'assignment']) {
    const h = harness()
    if (failure === 'constructor')
      h.metadata.mockImplementationOnce(() => {
        throw Error('Unsupported metadata')
      })
    else {
      let current = h.session.metadata
      Object.defineProperty(h.session, 'metadata', {
        get: () => current,
        set: (value: MediaMetadata | null) => {
          if (value !== null) throw Error('Unsupported metadata')
          current = value
        },
      })
    }
    h.state.track = 2
    expect(() => h.adapter.update()).not.toThrow()
    expect(h.session.metadata).toBeNull()
    h.handlers.get('play')!({ action: 'play' })
    expect(h.host.play).toHaveBeenCalledOnce()
  }
})

it('reports established playback through buffering and clears it on blocked playback, errors, pause, and source changes', () => {
  const h = harness()
  h.state.wantsPlay = true
  h.state.status = 'buffering'
  h.adapter.update()
  expect(h.session.playbackState).toBe('paused')
  h.state.status = 'playing'
  h.adapter.update()
  expect(h.session.playbackState).toBe('playing')
  h.state.status = 'buffering'
  h.adapter.update()
  expect(h.session.playbackState).toBe('playing')
  for (const status of ['blocked', 'error', 'paused', 'ended'] as const) {
    h.state.status = status
    h.adapter.update()
    expect(h.session.playbackState).toBe('paused')
  }
  h.state.status = 'playing'
  h.state.wantsPlay = false
  h.adapter.update()
  expect(h.session.playbackState).toBe('paused')
})

it('throttles confirmed positions, forces action updates, clamps bounds, and clears unknown or stale timelines', () => {
  const h = harness()
  const write = vi.mocked(h.session.setPositionState!)
  expect(write).toHaveBeenLastCalledWith({
    duration: 3610,
    position: 12.25,
    playbackRate: 1,
  })
  write.mockClear()
  h.state.currentTime = 13
  h.adapter.update()
  expect(write).not.toHaveBeenCalled()
  h.advance(999)
  h.adapter.update()
  expect(write).not.toHaveBeenCalled()
  h.advance(1)
  h.adapter.update()
  expect(write).toHaveBeenCalledExactlyOnceWith({
    duration: 3610,
    position: 13,
    playbackRate: 1,
  })
  h.state.currentTime = 14
  h.adapter.update(true)
  expect(write).toHaveBeenLastCalledWith({
    duration: 3610,
    position: 14,
    playbackRate: 1,
  })
  write.mockClear()
  h.state.pendingSeek = 200
  h.state.currentTime = 200
  h.adapter.update(true)
  h.state.pendingSeek = null
  h.state.seeking = true
  h.adapter.update(true)
  expect(write).not.toHaveBeenCalled()
  h.state.seeking = false
  h.state.currentTime = -1
  h.adapter.update(true)
  expect(write).toHaveBeenLastCalledWith({
    duration: 3610,
    position: 0,
    playbackRate: 1,
  })
  h.state.currentTime = 9999
  h.adapter.update(true)
  expect(write).toHaveBeenLastCalledWith({
    duration: 3610,
    position: 3610,
    playbackRate: 1,
  })
  for (const duration of [null, 0, -1, NaN, Infinity]) {
    h.state.duration = duration
    h.adapter.update()
    expect(h.handlers.get('seekto')).toBeNull()
    expect(write).toHaveBeenLastCalledWith()
  }
  h.state.duration = 40
  h.state.currentTime = NaN
  h.adapter.update()
  expect(write).toHaveBeenLastCalledWith()
  h.state.currentTime = 2
  h.adapter.update()
  expect(write).toHaveBeenLastCalledWith({
    duration: 40,
    position: 2,
    playbackRate: 1,
  })
  h.state.sourceId = 'other'
  h.state.pendingSeek = 20
  h.adapter.update()
  expect(write).toHaveBeenLastCalledWith()
})

it('cleans up handlers and metadata across suspension and disposal, including retained callbacks', () => {
  const h = harness()
  const play = h.handlers.get('play')!
  h.adapter.suspend()
  h.adapter.suspend()
  h.adapter.update()
  play({ action: 'play' })
  expect(h.host.play).not.toHaveBeenCalled()
  expect(h.session.metadata).toBeNull()
  expect(h.session.playbackState).toBe('none')
  expect(h.session.setPositionState).toHaveBeenLastCalledWith()
  expect([...h.handlers.values()].every((value) => value === null)).toBe(true)
  h.adapter.resume()
  expect(h.session.metadata!.title).toBe('Troglodyte')
  h.handlers.get('play')!({ action: 'play' })
  expect(h.host.play).toHaveBeenCalledOnce()
  h.adapter.dispose()
  h.adapter.dispose()
  h.adapter.suspend()
  h.adapter.resume()
  h.adapter.update(true)
  play({ action: 'play' })
  expect(h.host.play).toHaveBeenCalledOnce()
  expect(h.session.metadata).toBeNull()
})

it('tolerates missing and individually throwing APIs without breaking supported actions', () => {
  const h = harness()
  const absent = createMediaSession(undefined, undefined, h.host)
  absent.update()
  absent.suspend()
  absent.resume()
  absent.dispose()
  const supported = vi.fn()
  const partial: MediaSessionPort = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: (action, callback) => {
      if (action === 'play') supported(callback)
      else throw Error('Unsupported action')
    },
  }
  Object.defineProperty(partial, 'playbackState', {
    set: () => {
      throw Error('Unavailable property')
    },
  })
  let adapter = createMediaSession(partial, undefined, h.host)
  adapter.update()
  expect(partial.metadata).toBeNull()
  supported.mock.calls.at(-1)![0]({ action: 'play' })
  expect(h.host.play).toHaveBeenCalledOnce()
  adapter.dispose()
  Object.defineProperty(partial, 'metadata', {
    set: () => {
      throw Error('Unavailable property')
    },
  })
  partial.setPositionState = () => {
    throw Error('Unsupported position')
  }
  adapter = createMediaSession(
    partial,
    () => {
      throw Error('Unsupported metadata')
    },
    h.host,
  )
  expect(() => {
    adapter.update()
    adapter.suspend()
    adapter.resume()
    adapter.dispose()
  }).not.toThrow()
})
