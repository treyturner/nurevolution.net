import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, nextTick } from 'vue'
import { expect, it } from 'vitest'
import { useEpisodePage } from '../../app/composables/useEpisodePage'
import { useEpisodePlaybackNavigation } from '../../app/composables/useEpisodePlaybackNavigation'
it('waits for the latest superseding selection, observes failure atomically, and releases waiters on disposal', async () => {
  let navigation!: ReturnType<typeof useEpisodePlaybackNavigation>
  let page!: ReturnType<typeof useEpisodePage>
  const wrapper = await mountSuspended(
    defineComponent({
      setup() {
        page = useEpisodePage()
        navigation = useEpisodePlaybackNavigation()
        return () => h('div')
      },
    }),
  )
  page.value.pendingPath = null
  page.value.failedPath = null
  await expect(navigation.waitForSelection()).resolves.toBe(true)
  page.value.pendingPath = '/one'
  const first = navigation.waitForSelection()
  page.value.pendingPath = '/two'
  await nextTick()
  page.value.pendingPath = null
  page.value.failedPath = '/two'
  await expect(first).resolves.toBe(false)
  await expect(navigation.waitForSelection()).resolves.toBe(false)
  page.value.failedPath = null
  page.value.pendingPath = '/three'
  const next = navigation.waitForSelection()
  page.value.pendingPath = null
  await expect(next).resolves.toBe(true)
  page.value.pendingPath = '/closing'
  const closing = navigation.waitForSelection()
  wrapper.unmount()
  await expect(closing).resolves.toBe(false)
  page.value.pendingPath = null
})
