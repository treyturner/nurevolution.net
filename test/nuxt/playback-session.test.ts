import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import ArchivePlayer from '../../app/components/ArchivePlayer.vue'
import { usePodcastPlayer } from '../../app/composables/usePodcastPlayer'
import type { useEpisodePlaybackNavigation } from '../../app/composables/useEpisodePlaybackNavigation'
import { resumeKey, visitKey } from '../../app/services/playback-storage'
import { episodeDetail } from '../../shared/content/public'
import { archiveCatalog } from '../fixtures/archive'
const episode = episodeDetail(
  archiveCatalog,
  archiveCatalog.episodes.find((e) => e.id === 'wp-417')!,
)
function seeded() {
  localStorage.setItem(
    visitKey,
    JSON.stringify({ schemaVersion: 1, lastVisitedAt: Date.now() }),
  )
  localStorage.setItem(
    resumeKey,
    JSON.stringify({
      schemaVersion: 1,
      episodeId: episode.id,
      positionSeconds: 8.25,
      updatedAt: Date.now(),
    }),
  )
}
function harness(navigation: ReturnType<typeof useEpisodePlaybackNavigation>) {
  return defineComponent({
    setup() {
      const player = usePodcastPlayer(() => episode, navigation)
      return () => h(ArchivePlayer, { episode, player })
    },
  })
}
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(visitKey)
  localStorage.removeItem(resumeKey)
})
it('does not turn an idle pagehide or bfcache return into a newer resume write or Play', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  const wrapper = await mountSuspended(
    harness({ isRoot: () => false, restore: async () => 'restored' }),
  )
  const newer = JSON.stringify({
    schemaVersion: 1,
    episodeId: 'wp-484',
    positionSeconds: 30,
    updatedAt: Date.now(),
  })
  localStorage.setItem(resumeKey, newer)
  window.dispatchEvent(new Event('pagehide'))
  expect(localStorage.getItem(resumeKey)).toBe(newer)
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  expect(localStorage.getItem(resumeKey)).toBe(newer)
  expect(play).not.toHaveBeenCalled()
  wrapper.unmount()
  expect(localStorage.getItem(resumeKey)).toBe(newer)
})
it('does not attach storage or audio until prerender activation', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(document, 'prerendering')
  Object.defineProperty(document, 'prerendering', {
    configurable: true,
    value: true,
  })
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => {})
  const wrapper = await mountSuspended(
    harness({ isRoot: () => false, restore: async () => 'restored' }),
  )
  expect(load).not.toHaveBeenCalled()
  expect(localStorage.getItem(visitKey)).toBeNull()
  Object.defineProperty(document, 'prerendering', {
    configurable: true,
    value: false,
  })
  document.dispatchEvent(new Event('prerenderingchange'))
  expect(load).toHaveBeenCalledOnce()
  expect(localStorage.getItem(visitKey)).not.toBeNull()
  wrapper.unmount()
  if (descriptor) Object.defineProperty(document, 'prerendering', descriptor)
  else Reflect.deleteProperty(document, 'prerendering')
})
it('never loads a late restore result after the owner unmounts', async () => {
  seeded()
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => {})
  let finish!: (value: 'restored') => void
  const promise = new Promise<'restored'>((resolve) => {
    finish = resolve
  })
  const wrapper = await mountSuspended(
    harness({ isRoot: () => true, restore: () => promise }),
  )
  expect(wrapper.text()).toContain('Restoring your place')
  wrapper.unmount()
  finish('restored')
  await promise
  await Promise.resolve()
  expect(load).not.toHaveBeenCalled()
})
it('contains denied browser storage while leaving the selected audio usable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const load = vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => {})
  const wrapper = await mountSuspended(
    harness({ isRoot: () => false, restore: async () => 'restored' }),
  )
  expect(load).toHaveBeenCalledOnce()
  expect(wrapper.get('h1').text()).toBe('Praxis')
  wrapper.unmount()
})
