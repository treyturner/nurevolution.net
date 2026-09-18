import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useCompactContainer } from '../../app/composables/useCompactContainer'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.style.removeProperty('font-size')
})

async function fixture(rem = false, show = true) {
  const visible = ref(show)
  let result: ReturnType<typeof useCompactContainer>
  const wrapper = await mountSuspended(
    defineComponent({
      setup() {
        result = useCompactContainer(rem ? 24 : 319, rem)
        return () =>
          visible.value ? h('div', { ref: result.container }) : null
      },
    }),
  )
  return { wrapper, visible, state: result! }
}

it('measures initial width, element replacement, and observer updates, then disconnects', async () => {
  const observe = vi.fn(),
    unobserve = vi.fn(),
    disconnect = vi.fn()
  let resize: () => void = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe = observe
      unobserve = unobserve
      disconnect = disconnect
    },
  )
  let width = 320
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    () => width,
  )
  const { wrapper, visible, state } = await fixture(false, false)
  expect(observe).not.toHaveBeenCalled()
  visible.value = true
  await nextTick()
  const first = state.container.value!
  expect(observe).toHaveBeenCalledWith(first)
  expect(state.compact.value).toBe(false)
  width = 319
  resize()
  expect(state.compact.value).toBe(true)
  visible.value = false
  await nextTick()
  expect(unobserve).toHaveBeenCalledWith(first)
  visible.value = true
  await nextTick()
  expect(state.container.value).not.toBe(first)
  expect(observe).toHaveBeenCalledWith(state.container.value)
  wrapper.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})

it('handles a missing observer through resize and honors enlarged rem sizing', async () => {
  vi.stubGlobal('ResizeObserver', undefined)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500)
  document.documentElement.style.fontSize = '16px'
  const { wrapper, state } = await fixture(true)
  expect(state.compact.value).toBe(false)
  document.documentElement.style.fontSize = '32px'
  window.dispatchEvent(new Event('resize'))
  expect(state.compact.value).toBe(true)
  const removed = vi.spyOn(window, 'removeEventListener')
  wrapper.unmount()
  expect(removed).toHaveBeenCalledWith('resize', expect.any(Function))
})
