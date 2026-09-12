import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import EpisodeList from '../../app/components/EpisodeList.vue'
import { archiveCatalog as catalog } from '../fixtures/archive'
import { episodeSummary } from '../../shared/content/public'

const episodes = catalog.episodes
  .slice(0, 2)
  .map((e) => episodeSummary(catalog, e))
const wrappers: VueWrapper[] = []
async function mount() {
  const wrapper = await mountSuspended(EpisodeList, {
    attachTo: document.body,
    props: {
      episodes,
      siteUrl: catalog.show.siteUrl,
      selectedId: episodes[0]!.id,
    },
  })
  wrappers.push(wrapper)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  return wrapper
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('copies the clicked episode’s public URL without selecting it and dismisses feedback after three seconds', async () => {
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const wrapper = await mount()
  const button = wrapper.findAll('.row-copy-link')[1]!
  ;(button.element as HTMLButtonElement).focus()
  await button.trigger('click')
  await flushPromises()
  expect(write).toHaveBeenCalledWith(
    new URL(episodes[1]!.path, catalog.show.siteUrl).href,
  )
  expect(wrapper.get('[aria-current="page"]').attributes('href')).toBe(
    episodes[0]!.path,
  )
  expect(document.activeElement).toBe(button.element)
  expect(wrapper.get('[role="status"]').text()).toBe('Episode link copied')
  expect(document.querySelectorAll('.copy-link-toast')).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(2999)
  expect(wrapper.get('[role="status"]').text()).toBe('Episode link copied')
  await vi.advanceTimersByTimeAsync(1)
  expect(wrapper.get('[role="status"]').text()).toBe('')
  expect(document.querySelector('.copy-link-toast')).toBeNull()
})

it('reports a rejected clipboard write instead of claiming success, and allows retry', async () => {
  const write = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    .mockResolvedValue()
  const wrapper = await mount()
  await wrapper.get('.row-copy-link').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toBe(
    'Couldn’t copy link. Please try again.',
  )
  await wrapper.get('.row-copy-link').trigger('click')
  await flushPromises()
  expect(write).toHaveBeenCalledTimes(2)
  expect(wrapper.get('[role="status"]').text()).toBe('Episode link copied')
})

it('ignores a stale clipboard result and restarts the toast lifetime for the latest click', async () => {
  let rejectFirst!: (error: Error) => void
  vi.spyOn(navigator.clipboard, 'writeText')
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject
        }),
    )
    .mockResolvedValue()
  const wrapper = await mount()
  await wrapper.get('.row-copy-link').trigger('click')
  expect(wrapper.get('[role="status"]').text()).toBe('')
  await wrapper.findAll('.row-copy-link')[1]!.trigger('click')
  await flushPromises()
  await vi.advanceTimersByTimeAsync(2000)
  rejectFirst(new Error('Old write failed'))
  await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toBe('Episode link copied')
  await wrapper.get('.row-copy-link').trigger('click')
  await flushPromises()
  await vi.advanceTimersByTimeAsync(1000)
  expect(document.querySelectorAll('.copy-link-toast')).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(2000)
  expect(document.querySelector('.copy-link-toast')).toBeNull()
})

it('cleans up visible toasts and ignores clipboard completion after the list unmounts', async () => {
  let resolve!: () => void
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const wrapper = await mount()
  await wrapper.get('.row-copy-link').trigger('click')
  await flushPromises()
  expect(document.querySelector('.copy-link-toast')).not.toBeNull()
  write.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await wrapper.get('.row-copy-link').trigger('click')
  wrapper.unmount()
  resolve()
  await flushPromises()
  expect(document.querySelector('.copy-link-toast')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})
