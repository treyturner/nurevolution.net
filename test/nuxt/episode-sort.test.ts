import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useNuxtApp } from '#app'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../app/app.vue'
import { useEpisodePage } from '../../app/composables/useEpisodePage'
import { resumeKey, visitKey } from '../../app/services/playback-storage'
import './content-endpoints'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(resumeKey)
  localStorage.removeItem(visitKey)
})

async function fixture() {
  let paused = true
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(
    () => paused,
  )
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(40)
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
  vi.spyOn(HTMLMediaElement.prototype, 'currentSrc', 'get').mockImplementation(
    function (this: HTMLMediaElement) {
      return this.src
    },
  )
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(function (this: HTMLMediaElement) {
      paused = true
      this.currentTime = 0
      this.dispatchEvent(new Event('loadedmetadata'))
    })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused = true
    this.dispatchEvent(new Event('pause'))
  })
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(async function (this: HTMLMediaElement) {
      paused = false
      this.dispatchEvent(new Event('play'))
      this.dispatchEvent(new Event('playing'))
    })
  const wrapper = await mountSuspended(App, { route: '/' })
  const nuxt = useNuxtApp()
  const state = await nuxt.runWithContext(useEpisodePage)
  const episodes = [...state.value.model!.episodes]
  const audio = wrapper.get('audio')
  const sort = wrapper.get('.episode-sort')
  const paths = () =>
    wrapper
      .findAll('.episode-list li > a:first-child')
      .map((link) => link.attributes('href'))
  return { wrapper, nuxt, state, episodes, audio, sort, paths, play, load }
}

it.each([0, 12])(
  'follows the top episode in both orders before playback starts (position %s)',
  async (position) => {
    const f = await fixture()
    f.audio.element.currentTime = position
    await f.audio.trigger('timeupdate')
    const newest = f.episodes[0]!,
      oldest = f.episodes.at(-1)!
    expect(f.state.value.model!.selected!.id).toBe(newest.id)
    expect(f.paths()).toEqual(f.episodes.map((episode) => episode.path))
    expect(f.sort.attributes('aria-label')).toBe(
      'Newest first. Sort episodes oldest first',
    )
    expect(f.wrapper.find('select').exists()).toBe(false)
    await f.sort.trigger('click')
    await vi.waitFor(() =>
      expect(f.state.value.model!.selected!.id).toBe(oldest.id),
    )
    expect(f.paths()).toEqual(
      [...f.episodes].reverse().map((episode) => episode.path),
    )
    expect(f.sort.attributes('aria-label')).toBe(
      'Oldest first. Sort episodes newest first',
    )
    expect(f.play).not.toHaveBeenCalled()
    await f.sort.trigger('click')
    await vi.waitFor(() =>
      expect(f.state.value.model!.selected!.id).toBe(newest.id),
    )
    expect(f.paths()).toEqual(f.episodes.map((episode) => episode.path))
    expect(f.play).not.toHaveBeenCalled()
    expect(f.wrapper.get('audio').element).toBe(f.audio.element)
    expect(f.state.value.model!.episodes).toEqual(f.episodes)
    f.wrapper.unmount()
  },
)

it.each(['playing', 'paused-at-zero', 'middle'])(
  'preserves the selected source and position while sorting (%s)',
  async (scenario) => {
    const f = await fixture()
    if (scenario === 'middle') await f.nuxt.$router.push(f.episodes[1]!.path)
    if (scenario === 'playing' || scenario === 'paused-at-zero') {
      await f.wrapper.get('[aria-label="Play"]').trigger('click')
      if (scenario === 'paused-at-zero')
        await f.wrapper.get('[aria-label="Pause"]').trigger('click')
    }
    if (scenario === 'playing') {
      f.audio.element.currentTime = 12
      await f.audio.trigger('timeupdate')
    }
    const id = f.state.value.model!.selected!.id
    const time = f.audio.element.currentTime
    const paused = f.audio.element.paused
    const loads = f.load.mock.calls.length
    await f.sort.trigger('click')
    expect(f.state.value.model!.selected!.id).toBe(id)
    expect(f.audio.element.currentTime).toBe(time)
    expect(f.audio.element.paused).toBe(paused)
    expect(f.load).toHaveBeenCalledTimes(loads)
    expect(f.sort.attributes('aria-label')).toBe(
      'Oldest first. Sort episodes newest first',
    )
    await f.sort.trigger('click')
    expect(f.state.value.model!.selected!.id).toBe(id)
    expect(f.audio.element.currentTime).toBe(time)
    expect(f.audio.element.paused).toBe(paused)
    expect(f.load).toHaveBeenCalledTimes(loads)
    f.wrapper.unmount()
  },
)

it('disables sorting while navigation is pending and for a single episode', async () => {
  const f = await fixture()
  f.state.value.pendingPath = f.episodes[1]!.path
  await f.wrapper.vm.$nextTick()
  expect(f.sort.attributes('aria-disabled')).toBe('true')
  await f.sort.trigger('click')
  expect(f.paths()).toEqual(f.episodes.map((episode) => episode.path))
  f.state.value.pendingPath = null
  f.state.value.model = { ...f.state.value.model!, episodes: [f.episodes[0]!] }
  await f.wrapper.vm.$nextTick()
  expect(f.sort.attributes('aria-disabled')).toBe('true')
  f.wrapper.unmount()
})
