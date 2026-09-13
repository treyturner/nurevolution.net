import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, expect, it, vi } from 'vitest'
import { createError, useNuxtApp } from '#app'
import { useEpisodePage } from '../../app/composables/useEpisodePage'
import middleware from '../../app/middleware/episode'
import ErrorPage from '../../app/error.vue'
import App from '../../app/app.vue'
import './content-endpoints'
afterEach(() => vi.restoreAllMocks())

it('announces accepted navigation without remounting the player', async () => {
  const wrapper = await mountSuspended(App, { route: '/' })
  const nuxt = useNuxtApp(),
    audio = wrapper.get('audio').element
  await nuxt.$router.push('/episodes/trey-turner-praxis')
  expect(wrapper.get('h1').text()).toBe('Praxis')
  expect(wrapper.get('#episode-selection-status').text()).toBe(
    'Selected Trey Turner — Praxis',
  )
  expect(wrapper.findAll('[role="status"], [aria-live]')).toHaveLength(2)
  expect(wrapper.findAll('[role="status"]')[1]!.text()).toBe('')
  expect(wrapper.get('audio').attributes('aria-describedby')).toBe(
    'playback-status',
  )
  expect(wrapper.get('#playback-status').attributes('role')).toBeUndefined()
  expect(wrapper.get('audio').element).toBe(audio)
  const state = await nuxt.runWithContext(useEpisodePage)
  state.value.failedPath = '/episodes/unknown'
  await wrapper.vm.$nextTick()
  expect(wrapper.get('[role="alert"]').text()).toContain('Could not load')
  state.value.model = { ...state.value.model!, selected: null }
  await wrapper.vm.$nextTick()
  expect(wrapper.get('#episode-selection-status').text()).toBe(
    'No episodes are available.',
  )
  wrapper.unmount()
})

it('rejects encoded delimiters during navigation while preserving the current player', async () => {
  const path = '/episodes/trey-turner-praxis'
  const wrapper = await mountSuspended(App, { route: '/' })
  const nuxt = useNuxtApp(),
    audio = wrapper.get('audio').element
  await nuxt.$router.push(path)
  for (const slug of [
    '%23foo',
    '%3Ffoo',
    'trey-turner-praxis%23foo',
    'trey-turner-praxis%3Ffoo',
  ]) {
    await nuxt.$router.push(`/episodes/${slug}`)
    expect(nuxt.$router.currentRoute.value.path).toBe(path)
    expect(wrapper.get('h1').text()).toBe('Praxis')
    expect(wrapper.get('audio').element).toBe(audio)
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load')
    expect(wrapper.get('[role="alert"] a').attributes('href')).toBe(
      `/episodes/${slug}`,
    )
  }
  wrapper.unmount()
})

it('reuses hydration data, aborts superseded navigation, and distinguishes initial errors from selection failures', async () => {
  const nuxt = useNuxtApp(),
    state = await nuxt.runWithContext(useEpisodePage)
  const resolved = nuxt.$router.resolve('/episodes/missing')
  const to = { ...resolved, name: resolved.name ?? undefined }
  const from = nuxt.$router.currentRoute.value
  const invoke = () => nuxt.runWithContext(() => middleware(to, from))
  const prepare = vi.spyOn(nuxt.$episodeNavigation, 'prepare')
  state.value.path = to.path
  nuxt.isHydrating = true
  await invoke()
  expect(prepare).not.toHaveBeenCalled()
  nuxt.isHydrating = false
  prepare.mockResolvedValueOnce(false)
  expect(await invoke()).toBe(false)
  prepare.mockRejectedValueOnce(new Error('network'))
  expect(await invoke()).toBe(false)
  const previous = state.value.model
  state.value.model = null
  prepare.mockRejectedValueOnce({ statusCode: 404 })
  await expect(invoke()).rejects.toHaveProperty('statusCode', 404)
  prepare.mockRejectedValueOnce(new Error('storage'))
  await expect(invoke()).rejects.toHaveProperty('statusCode', 503)
  state.value.model = previous
})

it('provides a useful 404 and distinct retryable unavailable page', async () => {
  const wrapper = await mountSuspended(ErrorPage, {
    props: {
      error: createError({ statusCode: 404, statusMessage: 'Not found' }),
    },
  })
  expect(wrapper.get('h1').text()).toBe('Episode not found')
  expect(wrapper.get('a').attributes('href')).toBe('#main-content')
  expect(wrapper.find('button').exists()).toBe(false)
  await wrapper.setProps({
    error: createError({ statusCode: 503, statusMessage: 'Unavailable' }),
  })
  expect(wrapper.get('h1').text()).toContain('temporarily unavailable')
  expect(wrapper.get('button').text()).toBe('Try again')
  const reload = vi
    .spyOn(window.location, 'reload')
    .mockImplementation(() => {})
  await wrapper.get('button').trigger('click')
  expect(reload).toHaveBeenCalledOnce()
  wrapper.unmount()
})

it('connects manual sequencing, automatic completion, and single-source restart to the shared route session', async () => {
  let paused = true
  let ended = false
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(
    () => paused,
  )
  vi.spyOn(HTMLMediaElement.prototype, 'ended', 'get').mockImplementation(
    () => ended,
  )
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(40)
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
  vi.spyOn(HTMLMediaElement.prototype, 'currentSrc', 'get').mockImplementation(
    function (this: HTMLMediaElement) {
      return this.src
    },
  )
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused = true
    ended = false
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
      ended = false
      this.dispatchEvent(new Event('play'))
      this.dispatchEvent(new Event('playing'))
    })
  const wrapper = await mountSuspended(App, {
    route: '/episodes/trey-turner-praxis',
  })
  const nuxt = useNuxtApp()
  const state = await nuxt.runWithContext(useEpisodePage)
  const button = (name: string) =>
    wrapper.findAll('button').find((button) => button.text() === name)!
  const selected = state.value.model!.selected!
  const index = state.value.model!.episodes.findIndex(
    (episode) => episode.id === selected.id,
  )
  const older = state.value.model!.episodes[index + 1]!
  const newer = state.value.model!.episodes[index - 1]!
  await button('Next episode').trigger('click')
  await vi.waitFor(() => expect(state.value.model!.selected!.id).toBe(older.id))
  await button('Previous episode').trigger('click')
  await vi.waitFor(() =>
    expect(state.value.model!.selected!.id).toBe(selected.id),
  )
  await wrapper.get('.episode-sort').trigger('click')
  await wrapper.get('[aria-label="Play"]').trigger('click')
  const audio = wrapper.get('audio')
  ended = true
  paused = true
  await audio.trigger('ended')
  await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2))
  expect(state.value.model!.selected!.id).toBe(newer.id)
  await wrapper.get('[aria-label="Pause"]').trigger('click')
  state.value.model = {
    ...state.value.model!,
    episodes: [state.value.model!.selected!],
  }
  audio.element.currentTime = 12
  await audio.trigger('timeupdate')
  await button('Next episode').trigger('click')
  expect(audio.element.currentTime).toBe(0)
  expect(paused).toBe(true)
  wrapper.unmount()
})
