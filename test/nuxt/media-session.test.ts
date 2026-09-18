import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import {
  usePodcastPlayer,
  type PodcastPlayer,
} from '../../app/composables/usePodcastPlayer'
import type { MediaSessionPort } from '../../app/services/media-session'
import { episodeDetail } from '../../shared/content/public'
import { archiveCatalog } from '../fixtures/archive'

const originalSession = Object.getOwnPropertyDescriptor(
  navigator,
  'mediaSession',
)
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalSession)
    Object.defineProperty(navigator, 'mediaSession', originalSession)
  else Reflect.deleteProperty(navigator, 'mediaSession')
})

it('connects system actions, track metadata, and lifecycle cleanup to the mounted audio controller', async () => {
  const callbacks = new Map<
    MediaSessionAction,
    MediaSessionActionHandler | null
  >()
  const session: MediaSessionPort = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: (action, callback) => {
      callbacks.set(action, callback)
    },
    setPositionState: vi.fn(),
  }
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: session,
  })
  vi.stubGlobal('MediaMetadata', function Metadata(data: MediaMetadataInit) {
    return { ...data }
  })
  let player!: PodcastPlayer
  const base = episodeDetail(
    archiveCatalog,
    archiveCatalog.episodes.find((e) => e.id === 'wp-484')!,
  )
  const episode = ref({
    ...base,
    tracks: [0, 10, 30].map((startTime, i) => ({
      position: i + 1,
      startTime,
      artist: 'Artist',
      title: `Track ${i + 1}`,
    })),
  })
  const pending = ref(false)
  const wrapper = await mountSuspended(
    defineComponent({
      setup() {
        player = usePodcastPlayer(() => episode.value, {
          get pending() {
            return pending.value
          },
          timestamp: { kind: 'none' },
          showTitle: 'Show',
          neighbor: () => null,
          episodes: [],
          sortOrder: 'newest-first',
          toggleSort: () => {},
          move: async () => 'failed',
          waitForSelection: async () => true,
          isRoot: () => false,
          restore: async () => 'missing',
        })
        return () => h('audio', { ref: player.bindAudio })
      },
    }),
  )
  try {
    const audio = wrapper.get('audio').element
    let time = 2
    let seeking = false
    let paused = true
    const seek = vi.fn((value: number) => {
      time = value
      seeking = true
    })
    Object.defineProperties(audio, {
      currentTime: { configurable: true, get: () => time, set: seek },
      seeking: { configurable: true, get: () => seeking },
      paused: { configurable: true, get: () => paused },
      duration: { configurable: true, value: 40 },
      readyState: { configurable: true, value: 4 },
    })
    const emit = (event: string) => audio.dispatchEvent(new Event(event))
    vi.spyOn(audio, 'play').mockImplementation(async () => {
      paused = false
      emit('play')
      emit('playing')
    })
    vi.spyOn(audio, 'pause').mockImplementation(() => {
      paused = true
      emit('pause')
    })
    emit('loadedmetadata')
    expect(session.metadata).toMatchObject({
      title: 'Track 1',
      artist: 'Artist',
      album: 'Trey Turner - Ruminate',
    })
    callbacks.get('play')!({ action: 'play' })
    expect(paused).toBe(false)
    expect(session.playbackState).toBe('playing')
    callbacks.get('nexttrack')!({ action: 'nexttrack' })
    expect(seek).toHaveBeenLastCalledWith(10)
    seeking = false
    emit('seeked')
    expect(session.metadata!.title).toBe('Track 2')
    expect(session.setPositionState).toHaveBeenLastCalledWith({
      duration: 40,
      playbackRate: 1,
      position: 10,
    })
    expect(player.state.wantsPlay).toBe(true)
    callbacks.get('previoustrack')!({ action: 'previoustrack' })
    expect(seek).toHaveBeenLastCalledWith(0)
    seeking = false
    emit('seeked')
    time = 5
    emit('timeupdate')
    callbacks.get('previoustrack')!({ action: 'previoustrack' })
    expect(seek).toHaveBeenLastCalledWith(0)
    seeking = false
    emit('seeked')
    callbacks.get('seekto')!({
      action: 'seekto',
      seekTime: 12.25,
      fastSeek: true,
    })
    seeking = false
    emit('seeked')
    callbacks.get('seekforward')!({ action: 'seekforward', seekOffset: 5 })
    expect(time).toBe(17.25)
    seeking = false
    emit('seeked')
    callbacks.get('stop')!({ action: 'stop' })
    expect(paused).toBe(true)
    expect(time).toBe(17.25)
    callbacks.get('play')!({ action: 'play' })
    const next = callbacks.get('nexttrack')!
    pending.value = true
    await wrapper.vm.$nextTick()
    expect(callbacks.get('nexttrack')).toBeNull()
    const previousCalls = seek.mock.calls.length
    next({ action: 'nexttrack' })
    expect(seek).toHaveBeenCalledTimes(previousCalls)
    callbacks.get('pause')!({ action: 'pause' })
    expect(paused).toBe(true)
    pending.value = false
    await wrapper.vm.$nextTick()
    callbacks.get('play')!({ action: 'play' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(paused).toBe(false)
    window.dispatchEvent(new Event('pagehide'))
    expect(paused).toBe(true)
    expect(session.metadata).toBeNull()
    expect(callbacks.get('play')).toBeNull()
    const restored = new Event('pageshow')
    Object.defineProperty(restored, 'persisted', { value: true })
    window.dispatchEvent(restored)
    expect(session.playbackState).toBe('paused')
    expect(callbacks.get('play')).toBeTypeOf('function')
    episode.value = {
      ...episode.value,
      id: 'other',
      title: 'Untimed',
      tracks: [],
    }
    await wrapper.vm.$nextTick()
    emit('loadedmetadata')
    expect(session.metadata).toMatchObject({ title: 'Untimed', album: 'Show' })
    expect(callbacks.get('nexttrack')).toBeNull()
    expect(callbacks.get('previoustrack')).toBeNull()
  } finally {
    wrapper.unmount()
  }
  expect(session.metadata).toBeNull()
  expect(session.playbackState).toBe('none')
  expect([...callbacks.values()].every((value) => value === null)).toBe(true)
})

it('retains ordinary player initialization when the Media Session getter throws', async () => {
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    get: () => {
      throw Error('Unavailable')
    },
  })
  let player!: PodcastPlayer
  const episode = episodeDetail(archiveCatalog, archiveCatalog.episodes[0]!)
  const wrapper = await mountSuspended(
    defineComponent({
      setup() {
        player = usePodcastPlayer(() => episode)
        return () => h('audio', { ref: player.bindAudio })
      },
    }),
  )
  expect(player.state.initialized).toBe(true)
  expect(player.state.sourceId).toBe(episode.id)
  wrapper.unmount()
})
