import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import ArchivePlayer from '../../app/components/ArchivePlayer.vue'
import { usePodcastPlayer } from '../../app/composables/usePodcastPlayer'
import type { useEpisodePlaybackNavigation } from '../../app/composables/useEpisodePlaybackNavigation'
import { resumeKey, visitKey } from '../../app/services/playback-storage'
import { episodeDetail } from '../../shared/content/public'
import { archiveCatalog } from '../fixtures/archive'
const episode = episodeDetail(
  archiveCatalog,
  archiveCatalog.episodes.find((e) => e.id === 'wp-417')!,
)
function returnFromCache() {
  // Happy DOM aliases PageTransitionEvent to Event and drops its options.
  const event = new Event('pageshow')
  Object.defineProperty(event, 'persisted', { value: true })
  window.dispatchEvent(event)
}
function seeded() {
  localStorage.setItem(
    visitKey,
    JSON.stringify({ schemaVersion: 1, lastVisitedAt: Date.now() }),
  )
  localStorage.setItem(
    resumeKey,
    JSON.stringify({
      schemaVersion: 1,
      episodeId: episode.id,
      positionSeconds: 8.25,
      updatedAt: Date.now(),
    }),
  )
}
function harness(
  navigation: Pick<
    ReturnType<typeof useEpisodePlaybackNavigation>,
    'restore' | 'isRoot'
  > &
    Partial<
      Pick<ReturnType<typeof useEpisodePlaybackNavigation>, 'waitForSelection'>
    >,
) {
  return defineComponent({
    setup() {
      const player = usePodcastPlayer(() => episode, {
        pending: false,
        neighbor: () => null,
        move: async () => 'failed',
        waitForSelection: async () => true,
        ...navigation,
      })
      return () => h(ArchivePlayer, { episode, player })
    },
  })
}
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(visitKey)
  localStorage.removeItem(resumeKey)
})
it('does not turn an idle pagehide or bfcache return into a newer resume write or Play', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  const wrapper = await mountSuspended(
    harness({ isRoot: () => false, restore: async () => 'restored' }),
  )
  const newer = JSON.stringify({
    schemaVersion: 1,
    episodeId: 'wp-484',
    positionSeconds: 30,
    updatedAt: Date.now(),
  })
  localStorage.setItem(resumeKey, newer)
  window.dispatchEvent(new Event('pagehide'))
  expect(localStorage.getItem(resumeKey)).toBe(newer)
  returnFromCache()
  expect(localStorage.getItem(resumeKey)).toBe(newer)
  expect(play).not.toHaveBeenCalled()
  wrapper.unmount()
  expect(localStorage.getItem(resumeKey)).toBe(newer)
})
it('does not attach storage or audio until prerender activation', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(document, 'prerendering')
  Object.defineProperty(document, 'prerendering', {
    configurable: true,
    value: true,
  })
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => {})
  const wrapper = await mountSuspended(
    harness({ isRoot: () => false, restore: async () => 'restored' }),
  )
  expect(load).not.toHaveBeenCalled()
  expect(localStorage.getItem(visitKey)).toBeNull()
  Object.defineProperty(document, 'prerendering', {
    configurable: true,
    value: false,
  })
  document.dispatchEvent(new Event('prerenderingchange'))
  expect(load).toHaveBeenCalledOnce()
  expect(localStorage.getItem(visitKey)).not.toBeNull()
  wrapper.unmount()
  if (descriptor) Object.defineProperty(document, 'prerendering', descriptor)
  else Reflect.deleteProperty(document, 'prerendering')
})
it('never loads a late restore result after the owner unmounts', async () => {
  seeded()
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => {})
  let finish!: (value: 'restored') => void
  const promise = new Promise<'restored'>((resolve) => {
    finish = resolve
  })
  const wrapper = await mountSuspended(
    harness({ isRoot: () => true, restore: () => promise }),
  )
  expect(wrapper.text()).toContain('Restoring your place')
  wrapper.unmount()
  finish('restored')
  await promise
  await Promise.resolve()
  expect(load).not.toHaveBeenCalled()
})
it('contains denied browser storage while leaving the selected audio usable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => {})
  const wrapper = await mountSuspended(
    harness({ isRoot: () => false, restore: async () => 'restored' }),
  )
  expect(load).toHaveBeenCalledOnce()
  expect(wrapper.get('h1').text()).toBe('Praxis')
  wrapper.unmount()
})

it.each([
  [false, 'lifecycle'],
  [true, 'lifecycle'],
  [false, 'retry'],
  [true, 'retry'],
  [false, 'pause'],
  [true, 'pause'],
])(
  'consumes a deferred reset pause without overwriting newer progress (stale: %s; action: %s)',
  async (stale, action) => {
    let paused = true
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(
      () => paused,
    )
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
      paused = true
    })
    const wrapper = await mountSuspended(
      harness({ isRoot: () => false, restore: async () => 'restored' }),
    )
    const audio = wrapper.get('audio')
    paused = false
    await audio.trigger('play')
    audio.element.currentTime = 9
    const player = wrapper.findComponent(ArchivePlayer).props('player')
    if (action === 'retry') player.retry()
    if (action === 'pause') {
      player.pause()
      expect(JSON.parse(localStorage.getItem(resumeKey)!).positionSeconds).toBe(
        9,
      )
    }
    window.dispatchEvent(new Event('pagehide'))
    const newer = JSON.stringify({
      schemaVersion: 1,
      episodeId: 'wp-484',
      positionSeconds: 30,
      updatedAt: Date.now(),
    })
    localStorage.setItem(resumeKey, newer)
    returnFromCache()
    if (stale)
      Object.defineProperty(audio.element, 'currentSrc', {
        configurable: true,
        value: 'https://old.example/audio.mp3',
      })
    await audio.trigger('pause')
    expect(localStorage.getItem(resumeKey)).toBe(newer)
    if (stale)
      Object.defineProperty(audio.element, 'currentSrc', {
        configurable: true,
        value: '',
      })
    paused = false
    await audio.trigger('play')
    audio.element.currentTime = 12
    paused = true
    await audio.trigger('pause')
    expect(JSON.parse(localStorage.getItem(resumeKey)!)).toMatchObject({
      episodeId: episode.id,
      positionSeconds: 12,
    })
    wrapper.unmount()
  },
)

it('retains a cancelled restore record if the document closes during the superseding request', async () => {
  seeded()
  const original = localStorage.getItem(resumeKey)
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => {})
  let finish!: (accepted: boolean) => void
  const waiting = new Promise<boolean>((resolve) => {
    finish = resolve
  })
  const wrapper = await mountSuspended(
    harness({
      isRoot: () => true,
      restore: async () => 'cancelled',
      waitForSelection: () => waiting,
    }),
  )
  await Promise.resolve()
  expect(load).not.toHaveBeenCalled()
  wrapper.unmount()
  finish(true)
  await waiting
  await Promise.resolve()
  expect(load).not.toHaveBeenCalled()
  expect(localStorage.getItem(resumeKey)).toBe(original)
})

it('persists zero when Retry discards a pending restore and when the same ID receives replacement audio', async () => {
  vi.useFakeTimers()
  seeded()
  const selected = ref(episode)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.currentTime = 0
  })
  const wrapper = await mountSuspended(
    defineComponent({
      setup() {
        const player = usePodcastPlayer(() => selected.value, {
          isRoot: () => false,
          restore: async () => 'restored',
          pending: false,
          neighbor: () => null,
          move: async () => 'failed',
          waitForSelection: async () => true,
        })
        return () => h(ArchivePlayer, { episode: selected.value, player })
      },
    }),
  )
  await vi.advanceTimersByTimeAsync(20_000)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === 'Retry audio')!
    .trigger('click')
  expect(JSON.parse(localStorage.getItem(resumeKey)!)).toMatchObject({
    episodeId: episode.id,
    positionSeconds: 0,
  })
  const audio = wrapper.get('audio')
  Object.defineProperties(audio.element, {
    duration: { configurable: true, value: 40 },
    readyState: { configurable: true, value: 4 },
  })
  await audio.trigger('loadedmetadata')
  audio.element.currentTime = 12
  await audio.trigger('seeked')
  expect(JSON.parse(localStorage.getItem(resumeKey)!).positionSeconds).toBe(12)
  selected.value = {
    ...episode,
    audio: { ...episode.audio, url: episode.audio.url + '?replacement=1' },
  }
  await wrapper.vm.$nextTick()
  expect(audio.element.currentTime).toBe(0)
  expect(JSON.parse(localStorage.getItem(resumeKey)!).positionSeconds).toBe(0)
  expect(audio.element.paused).toBe(true)
  wrapper.unmount()
  vi.useRealTimers()
})

it('keeps saving actual activity after a seek times out with a visible error', async () => {
  vi.useFakeTimers()
  let paused = true
  let ended = false
  let position = 0
  const wrapper = await mountSuspended(
    harness({ isRoot: () => false, restore: async () => 'restored' }),
  )
  const audio = wrapper.get('audio')
  Object.defineProperties(audio.element, {
    paused: { configurable: true, get: () => paused },
    ended: { configurable: true, get: () => ended },
    currentTime: { configurable: true, get: () => position, set: () => {} },
    duration: { configurable: true, value: 40 },
    readyState: { configurable: true, value: 4 },
    seeking: { configurable: true, value: true },
  })
  await audio.trigger('loadedmetadata')
  paused = false
  await audio.trigger('playing')
  wrapper.findComponent(ArchivePlayer).props('player').seek(30)
  await vi.advanceTimersByTimeAsync(5000)
  expect(wrapper.text()).toContain('Could not seek. Try again.')
  position = 12
  await audio.trigger('timeupdate')
  expect(JSON.parse(localStorage.getItem(resumeKey)!).positionSeconds).toBe(12)
  position = 13
  paused = true
  await audio.trigger('pause')
  expect(JSON.parse(localStorage.getItem(resumeKey)!).positionSeconds).toBe(13)
  position = 40
  ended = true
  await audio.trigger('ended')
  expect(JSON.parse(localStorage.getItem(resumeKey)!).positionSeconds).toBe(40)
  wrapper.unmount()
  vi.useRealTimers()
})

it.each([false, true])(
  'saves a paused seek failure with its original activity time (newer tab: %s)',
  async (newerTab) => {
    vi.useFakeTimers()
    let paused = true
    let position = 0
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
      paused = true
    })
    const wrapper = await mountSuspended(
      harness({ isRoot: () => false, restore: async () => 'restored' }),
    )
    const audio = wrapper.get('audio')
    Object.defineProperties(audio.element, {
      paused: { configurable: true, get: () => paused },
      currentTime: { configurable: true, get: () => position, set: () => {} },
      duration: { configurable: true, value: 40 },
      readyState: { configurable: true, value: 4 },
      seeking: { configurable: true, value: true },
    })
    await audio.trigger('loadedmetadata')
    paused = false
    await audio.trigger('playing')
    position = 12
    await audio.trigger('timeupdate')
    const player = wrapper.findComponent(ArchivePlayer).props('player')
    await vi.advanceTimersByTimeAsync(5000)
    await audio.trigger('timeupdate')
    player.seek(30)
    position = 18
    player.pause()
    await audio.trigger('pause')
    expect(JSON.parse(localStorage.getItem(resumeKey)!).positionSeconds).toBe(
      12,
    )
    const pausedAt = Date.now()
    await vi.advanceTimersByTimeAsync(1000)
    if (newerTab)
      localStorage.setItem(
        resumeKey,
        JSON.stringify({
          schemaVersion: 1,
          episodeId: 'wp-484',
          positionSeconds: 27,
          updatedAt: Date.now(),
        }),
      )
    await vi.advanceTimersByTimeAsync(4000)
    expect(wrapper.text()).toContain('Could not seek. Try again.')
    expect(JSON.parse(localStorage.getItem(resumeKey)!)).toMatchObject(
      newerTab
        ? {
            episodeId: 'wp-484',
            positionSeconds: 27,
            updatedAt: pausedAt + 1000,
          }
        : { episodeId: episode.id, positionSeconds: 18, updatedAt: pausedAt },
    )
    expect(paused).toBe(true)
    wrapper.unmount()
    vi.useRealTimers()
  },
)
