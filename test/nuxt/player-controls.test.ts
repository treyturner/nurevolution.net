import { mountSuspended } from '@nuxt/test-utils/runtime'
import { reactive } from 'vue'
import { expect, it, vi } from 'vitest'
import PlayerControls from '../../app/components/PlayerControls.vue'
import type { PodcastPlayer } from '../../app/composables/usePodcastPlayer'
function fixture() {
  const state = reactive({
    sourceId: 'episode',
    status: 'paused' as const,
    wantsPlay: false,
    currentTime: 10,
    duration: 40 as number | null,
    seeking: false,
    pendingSeek: null as number | null,
    seekMessage: null,
    volume: 0.5,
    muted: false,
    volumeSupported: true,
    muteSupported: true,
    attached: true,
    restoring: false,
    restoreMessage: null,
  })
  const player: PodcastPlayer = {
    state,
    bindAudio: vi.fn(),
    retry: vi.fn(),
    play: vi.fn(() => {
      state.wantsPlay = true
    }),
    pause: vi.fn(() => {
      state.wantsPlay = false
    }),
    seek: vi.fn(),
    skip: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
  }
  return { player, state }
}
it('exposes honest Play/Pause and skip actions with known/unknown duration', async () => {
  const { player, state } = fixture()
  const wrapper = await mountSuspended(PlayerControls, { props: { player } })
  await wrapper.get('[aria-label="Play"]').trigger('click')
  expect(player.play).toHaveBeenCalledOnce()
  await wrapper.get('[aria-label="Pause"]').trigger('click')
  expect(player.pause).toHaveBeenCalledOnce()
  await wrapper.get('[aria-label="Back 30 seconds"]').trigger('click')
  await wrapper.get('[aria-label="Forward 30 seconds"]').trigger('click')
  expect(player.skip).toHaveBeenNthCalledWith(1, -30)
  expect(player.skip).toHaveBeenNthCalledWith(2, 30)
  state.duration = null
  await wrapper.vm.$nextTick()
  expect(
    wrapper.get('[aria-label="Playback position"]').attributes('disabled'),
  ).toBeDefined()
  expect(wrapper.text()).toContain('—:—')
  expect(
    wrapper.get('[aria-label="Play"]').attributes('disabled'),
  ).toBeUndefined()
  state.restoring = true
  await wrapper.vm.$nextTick()
  expect(
    wrapper.get('[aria-label="Play"]').attributes('disabled'),
  ).toBeDefined()
  wrapper.unmount()
})
it('previews a scrub without seeking or fighting progress, commits once, and cancels stale previews', async () => {
  const { player, state } = fixture()
  const wrapper = await mountSuspended(PlayerControls, { props: { player } })
  const input = wrapper.get<HTMLInputElement>(
    '[aria-label="Playback position"]',
  )
  input.element.value = '8.25'
  await input.trigger('input')
  expect(player.seek).not.toHaveBeenCalled()
  state.currentTime = 12
  await wrapper.vm.$nextTick()
  expect(input.element.value).toBe('8.25')
  expect(input.attributes('aria-valuetext')).toContain(
    '8 seconds of 40 seconds',
  )
  await input.trigger('change')
  expect(player.seek).toHaveBeenCalledExactlyOnceWith(8.25)
  input.element.value = '20'
  await input.trigger('input')
  await input.trigger('pointercancel')
  await input.trigger('change')
  expect(player.seek).toHaveBeenCalledOnce()
  input.element.value = '20'
  await input.trigger('input')
  state.sourceId = 'another'
  await wrapper.vm.$nextTick()
  await input.trigger('change')
  expect(player.seek).toHaveBeenCalledOnce()
  input.element.value = '15'
  await input.trigger('input')
  await input.trigger('keydown', { key: 'Escape' })
  await input.trigger('change')
  expect(player.seek).toHaveBeenCalledOnce()
  wrapper.unmount()
})
it('provides exact keyboard seek operations without global shortcuts and speaks long durations', async () => {
  const { player, state } = fixture()
  state.pendingSeek = 20
  const wrapper = await mountSuspended(PlayerControls, { props: { player } })
  const input = wrapper.get('[aria-label="Playback position"]')
  for (const [key, target] of [
    ['ArrowRight', 25],
    ['ArrowDown', 15],
    ['Home', 0],
    ['End', 40],
    ['PageUp', 50],
    ['PageDown', -10],
  ] as const) {
    await input.trigger('keydown', { key })
    expect(player.seek).toHaveBeenLastCalledWith(target)
  }
  await input.trigger('keydown', { key: 'x' })
  expect(player.seek).toHaveBeenCalledTimes(6)
  state.duration = 4000
  state.currentTime = 3661
  await wrapper.vm.$nextTick()
  expect(input.attributes('aria-valuetext')).toContain(
    '1 hour, 1 minute, 1 second',
  )
  state.duration = null
  await wrapper.vm.$nextTick()
  await input.trigger('keydown', { key: 'Home' })
  expect(player.seek).toHaveBeenCalledTimes(6)
  wrapper.unmount()
})
it('wires volume and mute independently and leaves no slider space for device-owned volume', async () => {
  const { player, state } = fixture()
  const wrapper = await mountSuspended(PlayerControls, { props: { player } })
  const input = wrapper.get<HTMLInputElement>('.volume-control input')
  input.element.value = '0.35'
  await input.trigger('input')
  expect(player.setVolume).toHaveBeenCalledWith(0.35)
  await wrapper.get('[aria-label="Mute"]').trigger('click')
  expect(player.toggleMute).toHaveBeenCalledOnce()
  state.muted = true
  await wrapper.vm.$nextTick()
  expect(wrapper.find('[aria-label="Unmute"]').exists()).toBe(true)
  state.volumeSupported = false
  await wrapper.vm.$nextTick()
  expect(wrapper.find('.volume-control').exists()).toBe(false)
  expect(wrapper.text()).toContain("Use your device's volume buttons.")
  expect(wrapper.find('[aria-label="Unmute"]').exists()).toBe(true)
  state.muteSupported = false
  await wrapper.vm.$nextTick()
  expect(wrapper.find('[aria-label="Unmute"]').exists()).toBe(false)
  wrapper.unmount()
})
