import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import ArchivePlayer from '../../app/components/ArchivePlayer.vue'
import EpisodeTracklist from '../../app/components/EpisodeTracklist.vue'
import {
  usePodcastPlayer,
  type PodcastPlayer,
} from '../../app/composables/usePodcastPlayer'
import { episodeDetail } from '../../shared/content/public'
import { archiveCatalog } from '../fixtures/archive'
const episode = episodeDetail(
  archiveCatalog,
  archiveCatalog.episodes.find((e) => e.id === 'wp-417')!,
)
afterEach(() => vi.restoreAllMocks())
it('toggles the current track without seeking, including a pending playback request', async () => {
  let player!: PodcastPlayer
  const selected = {
    ...episode,
    tracks: [0, 32].map((startTime, i) => ({
      position: i + 1,
      artist: 'Tone',
      title: `Track ${i + 1}`,
      startTime,
    })),
  }
  const wrapper = await mountSuspended(
    defineComponent({
      setup() {
        player = usePodcastPlayer(() => selected)
        return () =>
          h('div', [
            h('audio', { ref: player.bindAudio }),
            h(EpisodeTracklist, { player, tracks: selected.tracks }),
          ])
      },
    }),
  )
  try {
    const audio = wrapper.get('audio')
    let time = 12.345
    let paused = true
    const seek = vi.fn((value: number) => {
      time = value
    })
    Object.defineProperties(audio.element, {
      currentTime: { configurable: true, get: () => time, set: seek },
      duration: { configurable: true, value: 40 },
      readyState: { configurable: true, value: 4 },
      paused: { configurable: true, get: () => paused },
      seeking: { configurable: true, value: false },
    })
    vi.spyOn(audio.element, 'play').mockImplementation(async () => {
      paused = false
      audio.element.dispatchEvent(new Event('play'))
    })
    vi.spyOn(audio.element, 'pause').mockImplementation(() => {
      paused = true
      audio.element.dispatchEvent(new Event('pause'))
    })
    await audio.trigger('loadedmetadata')
    const row = wrapper.get('.track-list button')
    expect(row.attributes('aria-label')).toMatch(/^Play track 1:/)
    await row.trigger('click')
    await audio.trigger('playing')
    expect(row.attributes('aria-label')).toMatch(/^Pause track 1:/)
    expect(paused).toBe(false)
    expect(wrapper.find('.track-current').exists()).toBe(true)
    await row.trigger('click')
    expect(paused).toBe(true)
    expect(wrapper.find('.track-current').exists()).toBe(false)
    // A second click can also cancel Play before the browser starts playing.
    await row.trigger('click')
    await audio.trigger('waiting')
    expect(player.state.wantsPlay).toBe(true)
    await row.trigger('click')
    expect(player.state.wantsPlay).toBe(false)
    expect(paused).toBe(true)
    expect(time).toBe(12.345)
    expect(seek).not.toHaveBeenCalled()
    await wrapper.get('button[aria-label^="Seek to track 2:"]').trigger('click')
    expect(time).toBe(32)
    expect(paused).toBe(true)
  } finally {
    wrapper.unmount()
  }
})

it('keeps the same now-playing indicator through skips until the track changes or playback pauses', async () => {
  let player!: PodcastPlayer
  const selected = {
    ...episode,
    tracks: [0, 90].map((startTime, i) => ({
      position: i + 1,
      artist: 'Tone',
      title: `Track ${i + 1}`,
      startTime,
    })),
  }
  const wrapper = await mountSuspended(
    defineComponent({
      setup() {
        player = usePodcastPlayer(() => selected)
        return () =>
          h('div', [
            h('audio', { ref: player.bindAudio }),
            h(EpisodeTracklist, { player, tracks: selected.tracks }),
          ])
      },
    }),
  )
  try {
    const audio = wrapper.get('audio')
    Object.defineProperties(audio.element, {
      currentTime: { configurable: true, writable: true, value: 30 },
      duration: { configurable: true, value: 180 },
      readyState: { configurable: true, value: 4 },
      paused: { configurable: true, writable: true, value: false },
      seeking: { configurable: true, writable: true, value: false },
    })
    await audio.trigger('play')
    expect(wrapper.find('.track-current').exists()).toBe(false)
    await audio.trigger('playing')
    const indicator = wrapper.get('.track-current').element
    for (const offset of [30, -30]) {
      Object.assign(audio.element, { seeking: true })
      player.skip(offset)
      await audio.trigger('waiting')
      expect(wrapper.get('.track-current').element).toBe(indicator)
      expect(wrapper.get('.track-equalizer').classes()).toContain('is-playing')
      Object.assign(audio.element, { seeking: false })
      await audio.trigger('seeked')
      await audio.trigger('playing')
      expect(wrapper.get('.track-current').element).toBe(indicator)
    }
    Object.assign(audio.element, { currentTime: 80 })
    await audio.trigger('timeupdate')
    Object.assign(audio.element, { seeking: true })
    player.skip(30)
    await audio.trigger('waiting')
    expect(wrapper.get('.track-current').element).not.toBe(indicator)
    expect(wrapper.get('li[aria-current]').text()).toContain('Track 2')
    Object.assign(audio.element, { paused: true, seeking: false })
    await audio.trigger('pause')
    expect(wrapper.find('.track-current').exists()).toBe(false)
    player.skip(-30)
    await audio.trigger('seeked')
    expect(wrapper.find('.track-current').exists()).toBe(false)
    expect(wrapper.get('li[aria-current]').text()).toContain('Track 1')
  } finally {
    wrapper.unmount()
  }
})

it('shares queued track actions with controls, but highlights only confirmed positions', async () => {
  let player!: PodcastPlayer
  const selected = ref({
    ...episode,
    tracks: [0, 8.25, null, 32, 40].map((startTime, i) => ({
      position: i + 1,
      artist: 'Tone',
      title: `Track ${i + 1}`,
      startTime,
    })),
  })
  const wrapper = await mountSuspended(
    defineComponent({
      setup() {
        player = usePodcastPlayer(() => selected.value)
        return () =>
          h('div', [
            h(ArchivePlayer, { player, episode: selected.value }),
            h(EpisodeTracklist, { player, tracks: selected.value.tracks }),
          ])
      },
    }),
  )
  const audio = wrapper.get('audio')
  const element = audio.element
  let time = 0
  Object.defineProperties(element, {
    currentTime: {
      configurable: true,
      get: () => time,
      set: (value) => {
        time = value
      },
    },
    duration: { configurable: true, value: 40 },
    seeking: { configurable: true, value: true },
    readyState: { configurable: true, value: 0, writable: true },
  })
  await wrapper.get('[aria-label="Next track"]').trigger('click')
  expect(player.state.pendingSeek).toBe(8.25)
  await wrapper.get('[aria-label="Next track"]').trigger('click')
  expect(player.state.pendingSeek).toBe(32)
  expect(player.tracks.current).toBe(1)
  Object.defineProperty(element, 'readyState', { configurable: true, value: 1 })
  await audio.trigger('loadedmetadata')
  expect(time).toBe(32)
  Object.defineProperty(element, 'seeking', {
    configurable: true,
    value: false,
  })
  await audio.trigger('seeked')
  expect(player.state.pendingSeek).toBeNull()
  expect(wrapper.findAll('.track-list button')).toHaveLength(3)
  expect(wrapper.get('[aria-current="true"]').text()).toContain('Track 4')
  await wrapper.get('[aria-label="Previous track"]').trigger('click')
  expect(time).toBe(8.25)
  await audio.trigger('seeked')
  expect(wrapper.find('[aria-current]').exists()).toBe(false)
  await wrapper.get('button[aria-label^="Seek to track 1:"]').trigger('click')
  expect(time).toBe(0)
  player.seekTrack(5)
  expect(time).toBe(0)
  expect(element.paused).toBe(true)
  selected.value = { ...selected.value, tracks: [] }
  await wrapper.vm.$nextTick()
  player.previousTrack()
  player.nextTrack()
  expect(player.tracks.positions).toEqual([])
  expect(wrapper.text()).toContain('No tracklist is available')
  wrapper.unmount()
})
