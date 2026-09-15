import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import RssCopyButton from '../../app/components/RssCopyButton.vue'

const feedUrl = 'https://nurevolution.net/feed/podcast'
const wrappers: VueWrapper[] = []
async function mount() {
  const wrapper = await mountSuspended(RssCopyButton, {
    attachTo: document.body,
    props: { feedUrl },
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

it.each(['Desktop', 'Android'])(
  'copies the canonical feed URL and shows an accessible temporary toast on %s',
  async (agent) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent)
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const wrapper = await mount()
    const button = wrapper.get('button[aria-label="Copy RSS URL"]')
    ;(button.element as HTMLButtonElement).focus()
    await button.trigger('click')
    await flushPromises()
    expect(write).toHaveBeenCalledWith(feedUrl)
    expect(document.activeElement).toBe(button.element)
    expect(wrapper.get('[role="status"]').text()).toBe('RSS URL copied')
    expect(document.querySelector('.copy-link-toast')?.textContent).toBe(
      'RSS URL copied',
    )
    await vi.advanceTimersByTimeAsync(3000)
    expect(wrapper.get('[role="status"]').text()).toBe('')
    expect(document.querySelector('.copy-link-toast')).toBeNull()
  },
)

it('shows clipboard failure and permits another attempt', async () => {
  const write = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    .mockResolvedValue()
  const wrapper = await mount()
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toBe(
    'Couldn’t copy link. Please try again.',
  )
  expect(document.querySelector('.copy-link-toast')?.textContent).toBe(
    'Couldn’t copy link. Please try again.',
  )
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(write).toHaveBeenCalledTimes(2)
  expect(wrapper.get('[role="status"]').text()).toBe('RSS URL copied')
})
