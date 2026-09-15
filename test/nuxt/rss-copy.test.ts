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
    const button = wrapper.get(
      'a[aria-label="Subscribe via RSS (copy RSS URL)"]',
    )
    ;(button.element as HTMLAnchorElement).focus()
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

function activate(wrapper: VueWrapper, init: MouseEventInit = {}) {
  const link = wrapper.get('a').element
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  let prevented = false
  // Observe the component's decision, then suppress happy-dom navigation.
  link.addEventListener(
    'click',
    (event) => {
      prevented = event.defaultPrevented
      event.preventDefault()
    },
    { once: true },
  )
  link.dispatchEvent(event)
  return prevented
}

it('retains the visible subscription label and a safe canonical feed destination', async () => {
  const wrapper = await mount()
  expect(wrapper.get('a').attributes()).toMatchObject({
    href: feedUrl,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': 'Subscribe via RSS (copy RSS URL)',
  })
})

it('offers a native feed link after clipboard denial without claiming success', async () => {
  const write = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
  const wrapper = await mount()
  expect(activate(wrapper)).toBe(true)
  await flushPromises()
  const message =
    'Couldn’t copy RSS URL. Click again to open the feed in a new tab.'
  expect(wrapper.get('[role="status"]').text()).toBe(message)
  expect(document.querySelector('.copy-link-toast')?.textContent).toBe(message)
  expect(wrapper.get('a').attributes('aria-label')).toBe(
    'Subscribe via RSS (opens in a new tab)',
  )
  await vi.advanceTimersByTimeAsync(3000)
  expect(wrapper.get('a').attributes('title')).toBe(
    'Open RSS feed in a new tab',
  )
  expect(activate(wrapper)).toBe(false)
  expect(write).toHaveBeenCalledTimes(1)
})

it('allows native navigation when the Clipboard API is unavailable', async () => {
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(
    undefined as unknown as Clipboard,
  )
  const wrapper = await mount()
  expect(wrapper.get('a').attributes('aria-label')).toBe(
    'Subscribe via RSS (opens in a new tab)',
  )
  expect(wrapper.get('a').attributes('title')).toBe(
    'Open RSS feed in a new tab',
  )
  expect(activate(wrapper)).toBe(false)
  expect(wrapper.get('[role="status"]').text()).toBe('')
})

it.each([
  { ctrlKey: true },
  { metaKey: true },
  { shiftKey: true },
  { altKey: true },
  { button: 1 },
])('preserves modified link activation: %j', async (init) => {
  const write = vi.spyOn(navigator.clipboard, 'writeText')
  const wrapper = await mount()
  expect(activate(wrapper, init)).toBe(false)
  expect(write).not.toHaveBeenCalled()
})
