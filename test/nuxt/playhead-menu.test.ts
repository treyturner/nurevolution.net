import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import PlayheadContextMenu from '../../app/components/PlayheadContextMenu.vue'

const wrappers: { unmount(): void }[] = []
async function mount(enabled = true) {
  const wrapper = await mountSuspended(PlayheadContextMenu, {
    props: { enabled, sourceKey: 'first' },
    slots: {
      default:
        '<span>0:10</span><input type="range" min="0" max="40" value="10" />',
    },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  vi.spyOn(
    wrapper.get('input').element,
    'getBoundingClientRect',
  ).mockReturnValue(new DOMRect(26, 68, 200, 44))
  return wrapper
}
async function openMenu(wrapper: Awaited<ReturnType<typeof mount>>) {
  await wrapper
    .get('input')
    .trigger('contextmenu', { clientX: 80, clientY: 90 })
  await nextTick()
}
const item = () =>
  document.querySelector<HTMLButtonElement>('[role="menuitem"]')!
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.useRealTimers()
})

it('opens only on demand and copies through a stable playhead target with focus restored', async () => {
  const wrapper = await mount()
  expect(item()).toBeNull()
  await openMenu(wrapper)
  expect(item().textContent).toContain('Copy timestamp link')
  expect(document.activeElement).toBe(item())
  expect(wrapper.emitted('open')).toHaveLength(1)
  item().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  expect(item()).not.toBeNull()
  item().click()
  await nextTick()
  expect(wrapper.emitted('copy')).toEqual([[wrapper.get('input').element]])
  expect(item()).toBeNull()
  expect(document.activeElement).toBe(wrapper.get('input').element)
})

it('supports context-menu keys, menu navigation, Escape and normal Tab exit', async () => {
  const wrapper = await mount()
  const input = wrapper.get('input')
  await input.trigger('keydown', { key: 'F10' })
  expect(item()).toBeNull()
  await input.trigger('keydown', { key: 'F10', shiftKey: true })
  for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'x']) {
    item().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    expect(document.activeElement).toBe(item())
  }
  item().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )
  await nextTick()
  expect(item()).toBeNull()
  expect(document.activeElement).toBe(input.element)
  await input.trigger('keydown', { key: 'ContextMenu' })
  item().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
  )
  await nextTick()
  expect(item()).toBeNull()
  expect(wrapper.emitted('copy')).toBeUndefined()
})

it('dismisses on outside activity, scroll, resize, unavailable copying and source changes', async () => {
  const wrapper = await mount()
  for (const event of ['pointerdown', 'focusin', 'scroll', 'resize']) {
    await openMenu(wrapper)
    document.body.dispatchEvent(new Event(event, { bubbles: true }))
    await nextTick()
    expect(item()).toBeNull()
  }
  await openMenu(wrapper)
  await wrapper.setProps({ sourceKey: 'second' })
  expect(item()).toBeNull()
  await openMenu(wrapper)
  await wrapper.setProps({ enabled: false })
  expect(item()).toBeNull()
  await openMenu(wrapper)
  await wrapper.get('input').trigger('keydown', { key: 'ContextMenu' })
  expect(item()).toBeNull()
})

it('uses a stationary primary touch hold and cancels drags, taps and interrupted gestures', async () => {
  const wrapper = await mount()
  vi.useFakeTimers()
  const input = wrapper.get('input')
  const touch = {
    pointerType: 'touch',
    isPrimary: true,
    clientX: 80,
    clientY: 90,
  }
  for (const pointer of [
    { pointerType: 'mouse', isPrimary: true },
    { ...touch, isPrimary: false },
  ]) {
    await input.trigger('pointerdown', pointer)
    await vi.advanceTimersByTimeAsync(650)
    expect(item()).toBeNull()
  }
  for (const event of ['pointerup', 'pointercancel', 'pointerleave']) {
    await input.trigger('pointerdown', touch)
    await wrapper.get('.seek-row').trigger(event)
    await vi.advanceTimersByTimeAsync(650)
    expect(item()).toBeNull()
  }
  await input.trigger('pointerdown', touch)
  await input.trigger('pointermove', { ...touch, clientX: 110 })
  await vi.advanceTimersByTimeAsync(650)
  expect(item()).toBeNull()
  await input.trigger('pointerdown', touch)
  await input.trigger('pointermove', { ...touch, clientX: 83 })
  await vi.advanceTimersByTimeAsync(650)
  expect(item()).not.toBeNull()
  await input.trigger('pointerup', touch)
  expect(item()).not.toBeNull()
})

it('opens on the thumb at either end or in the middle, but excludes the rail and time labels', async () => {
  const wrapper = await mount()
  const input = wrapper.get<HTMLInputElement>('input')
  for (const [value, x] of [
    [0, 34],
    [20, 126],
    [40, 218],
  ]) {
    input.element.value = String(value)
    for (const [clientX, clientY] of [
      [x! + 9, 90],
      [x!, 99],
    ]) {
      await input.trigger('contextmenu', { clientX, clientY })
      expect(item()).toBeNull()
    }
    await wrapper
      .get('span')
      .trigger('contextmenu', { clientX: x, clientY: 90 })
    expect(item()).toBeNull()
    await input.trigger('contextmenu', { clientX: x, clientY: 90 })
    await nextTick()
    expect(item()).not.toBeNull()
    item().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await nextTick()
  }
})

it('does not turn an off-thumb touch into a menu after the native slider moves under it', async () => {
  const wrapper = await mount()
  vi.useFakeTimers()
  const input = wrapper.get<HTMLInputElement>('input')
  const point = {
    pointerType: 'touch',
    isPrimary: true,
    clientX: 126,
    clientY: 90,
  }
  await input.trigger('pointerdown', point)
  input.element.value = '20'
  await vi.advanceTimersByTimeAsync(650)
  await input.trigger('contextmenu', point)
  expect(item()).toBeNull()
  expect(wrapper.emitted('open')).toBeUndefined()
})
