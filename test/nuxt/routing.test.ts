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
  expect(wrapper.get('.sr-only').text()).toBe('Selected Trey Turner — Praxis')
  expect(wrapper.get('audio').element).toBe(audio)
  const state = await nuxt.runWithContext(useEpisodePage)
  state.value.failedPath = '/episodes/unknown'
  await wrapper.vm.$nextTick()
  expect(wrapper.get('[role="alert"]').text()).toContain('Could not load')
  state.value.model = { ...state.value.model!, selected: null }
  await wrapper.vm.$nextTick()
  expect(wrapper.get('.sr-only').text()).toBe('No episodes are available.')
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
