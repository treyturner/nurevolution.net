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
