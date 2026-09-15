import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useNuxtApp } from '#app'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../app/app.vue'
import { resumeKey, visitKey } from '../../app/services/playback-storage'
import './content-endpoints'

const praxis = '/episodes/trey-turner-praxis'
const ruminate = '/episodes/trey-turner-ruminate'
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
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
    async function (this: HTMLMediaElement) {
      paused = false
      this.dispatchEvent(new Event('play'))
      this.dispatchEvent(new Event('playing'))
    },
  )
  const wrapper = await mountSuspended(App, { route: praxis })
  return { wrapper, router: useNuxtApp().$router, load }
}

it('cancels with no source change and confirms an active selection without remounting audio', async () => {
  const { wrapper, router, load } = await fixture()
  try {
    await wrapper.get('[aria-label="Play"]').trigger('click')
    const audio = wrapper.get('audio')
    audio.element.currentTime = 12
    await audio.trigger('timeupdate')
    const initialLoads = load.mock.calls.length
    const cancelled = router.push(ruminate)
    await vi.waitFor(() => expect(wrapper.find('dialog').exists()).toBe(true))
    expect(wrapper.get('dialog h2').text()).toBe(
      'Stop playback to change episodes?',
    )
    expect(wrapper.get('dialog p').text()).toContain('Ruminate')
    expect(load).toHaveBeenCalledTimes(initialLoads)
    await wrapper.get('dialog button[autofocus]').trigger('click')
    await cancelled
    expect(router.currentRoute.value.path).toBe(praxis)
    expect(audio.element.currentTime).toBe(12)
    expect(audio.element.paused).toBe(false)
    const accepted = router.push(ruminate)
    await vi.waitFor(() => expect(wrapper.find('dialog').exists()).toBe(true))
    await wrapper.get('dialog button:last-child').trigger('click')
    await accepted
    expect(router.currentRoute.value.path).toBe(ruminate)
    expect(wrapper.get('audio').element).toBe(audio.element)
    expect(audio.element.paused).toBe(false)
    expect(load).toHaveBeenCalledTimes(initialLoads + 1)
  } finally {
    wrapper.unmount()
  }
})

it('skips paused and same-episode prompts and cancels pending navigation when the dialog closes or unmounts', async () => {
  const { wrapper, router } = await fixture()
  await router.push(ruminate)
  expect(wrapper.find('dialog').exists()).toBe(false)
  await wrapper.get('[aria-label="Play"]').trigger('click')
  await router.push(ruminate)
  expect(wrapper.find('dialog').exists()).toBe(false)
  const cancelled = router.push(praxis)
  await vi.waitFor(() => expect(wrapper.find('dialog').exists()).toBe(true))
  await wrapper.get('dialog').trigger('cancel')
  await cancelled
  expect(router.currentRoute.value.path).toBe(ruminate)
  const backdrop = router.push(praxis)
  await vi.waitFor(() => expect(wrapper.find('dialog').exists()).toBe(true))
  vi.spyOn(
    wrapper.get('dialog').element,
    'getBoundingClientRect',
  ).mockReturnValue(new DOMRect(100, 100, 400, 200))
  await wrapper.get('dialog').trigger('click', { clientX: 110, clientY: 110 })
  expect(wrapper.find('dialog').exists()).toBe(true)
  await wrapper.get('dialog').trigger('click', { clientX: 10, clientY: 10 })
  await backdrop
  expect(router.currentRoute.value.path).toBe(ruminate)
  const disposed = router.push(praxis)
  await vi.waitFor(() => expect(wrapper.find('dialog').exists()).toBe(true))
  wrapper.unmount()
  await disposed
  expect(router.currentRoute.value.path).toBe(ruminate)
})
