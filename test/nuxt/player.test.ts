import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import './content-endpoints'
import ArchivePlayer from '../../app/components/ArchivePlayer.vue'
import ArchiveLists from '../../app/components/ArchiveLists.vue'
import EpisodeTracklist from '../../app/components/EpisodeTracklist.vue'
import { archiveCatalog as catalog } from '../fixtures/archive'
import {
  episodeDetail,
  episodeSummary,
  selectPublic,
} from '../../shared/content/public'
const episodes = selectPublic(catalog, Date.parse('2026-09-08'))
const detail = (id: string) =>
  episodeDetail(
    catalog,
    episodes.find((e) => e.id === id)!,
  )
afterEach(() => {
  vi.restoreAllMocks()
})

describe('archive presentation and native media integration', () => {
  it('renders every canonical track in order, including all empty lists, without track controls', async () => {
    let count = 0
    const wrapper = await mountSuspended(EpisodeTracklist, {
      props: { tracks: [] },
    })
    for (const episode of episodes) {
      await wrapper.setProps({ tracks: episode.tracks })
      const rows = wrapper.findAll('li')
      expect(rows).toHaveLength(episode.tracks.length)
      for (let i = 0; i < rows.length; i++) {
        expect(rows[i]!.get('.track-artist').element.textContent).toBe(
          episode.tracks[i]!.artist,
        )
        expect(rows[i]!.get('.track-title').element.textContent).toBe(
          episode.tracks[i]!.title,
        )
      }
      if (!rows.length)
        expect(wrapper.text()).toContain('No tracklist is available')
      expect(wrapper.findAll('button, a, [tabindex]')).toHaveLength(0)
      count += rows.length
    }
    expect(count).toBe(832)
    wrapper.unmount()
  })
  it('keeps the element while props change and recovers from artwork/audio errors', async () => {
    const load = vi
      .spyOn(HTMLMediaElement.prototype, 'load')
      .mockImplementation(() => {})
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue()
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {})
    const wrapper = await mountSuspended(ArchivePlayer, {
      props: { episode: detail('wp-417') },
    })
    const audio = wrapper.get('audio').element
    expect(load).toHaveBeenCalledOnce()
    expect(play).not.toHaveBeenCalled()
    await wrapper.get('img').trigger('error')
    expect(wrapper.get('[role="img"]').attributes('aria-label')).toContain(
      'unavailable',
    )
    Object.defineProperty(audio, 'error', {
      configurable: true,
      value: { code: 2 },
    })
    await wrapper.get('audio').trigger('error')
    expect(wrapper.text()).toContain('Audio could not be loaded')
    await wrapper.get('button').trigger('click')
    expect(load).toHaveBeenCalledTimes(2)
    expect(play).not.toHaveBeenCalled()
    await wrapper.setProps({ episode: detail('wp-484') })
    expect(wrapper.get('audio').element).toBe(audio)
    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.get('.download-link').attributes('download')).toBe(
      detail('wp-484').audio.downloadFilename,
    )
    await wrapper.setProps({ episode: null })
    expect(wrapper.get('h1').text()).toBe('Podcast archive')
    expect(wrapper.find('.download-link').exists()).toBe(false)
    wrapper.unmount()
    expect(pause).toHaveBeenCalled()
  })
  it('renders safe descriptions and meaningful artwork for long titles and Unicode', async () => {
    const wrapper = await mountSuspended(ArchivePlayer, {
      props: { episode: detail('wp-267') },
    })
    for (const id of ['wp-267', 'wp-269', 'wp-197', 'wp-473']) {
      const episode = detail(id)
      await wrapper.setProps({ episode })
      expect(wrapper.get('h1').text()).toBe(episode.title)
      expect(wrapper.get('img').attributes('alt')).toContain(episode.artist)
      const expected = document.createElement('div')
      expected.innerHTML = episode.descriptionHtml
      expect(wrapper.get('.description').element.innerHTML).toBe(
        expected.innerHTML,
      )
    }
    wrapper.unmount()
  })
  it('opens the original artwork and clears the dialog on dismissal, image failure, or selection', async () => {
    const wrapper = await mountSuspended(ArchivePlayer, {
      attachTo: document.body,
      props: { episode: detail('wp-417') },
    })
    const open = async () => {
      await wrapper.get('.artwork-trigger').trigger('click')
      expect(wrapper.get('dialog').element.open).toBe(true)
    }
    await open()
    expect(wrapper.get('dialog img').attributes('src')).toBe(
      wrapper.get('.artwork img').attributes('src'),
    )
    const modal = wrapper.get('dialog').element
    Object.defineProperties(modal, {
      scrollWidth: { value: 1400 },
      clientWidth: { value: 800 },
      scrollHeight: { value: 1000 },
      clientHeight: { value: 600 },
    })
    const scroll = vi.spyOn(modal, 'scrollTo')
    await wrapper.get('dialog img').trigger('load')
    expect(scroll).toHaveBeenCalledWith(300, 200)
    await wrapper.get('dialog img').trigger('click')
    expect(modal.open).toBe(true)
    await wrapper.get('.artwork-dialog-stage').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
    await open()
    await wrapper.get('.artwork-dialog-close').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
    await open()
    await wrapper.get('dialog').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
    await open()
    await wrapper.get('dialog img').trigger('error')
    expect(wrapper.find('dialog').exists()).toBe(false)
    await open()
    await wrapper.setProps({ episode: detail('wp-484') })
    expect(wrapper.find('dialog').exists()).toBe(false)
    wrapper.unmount()
  })
  it('supports keyboard tabs on narrow screens and returns to the two-column list on resize', async () => {
    const query = new EventTarget() as MediaQueryList
    Object.defineProperty(query, 'matches', { configurable: true, value: true })
    vi.spyOn(window, 'matchMedia').mockReturnValue(query)
    const wrapper = await mountSuspended(ArchiveLists, {
      attachTo: document.body,
      props: {
        episodes: episodes.map((e) => episodeSummary(catalog, e)),
        selected: detail('wp-417'),
        pendingPath: '/episodes/trey-turner-ruminate',
      },
    })
    expect(wrapper.findAll('.episode-list li')).toHaveLength(55)
    expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(1)
    expect(wrapper.get('[aria-busy="true"]').attributes('href')).toBe(
      '/episodes/trey-turner-ruminate',
    )
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[0]!.trigger('keydown', { key: 'ArrowRight' })
    expect(tabs[1]!.attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1]!.element)
    await tabs[1]!.trigger('keydown', { key: 'ArrowLeft' })
    await tabs[0]!.trigger('keydown', { key: 'End' })
    await tabs[1]!.trigger('keydown', { key: 'Home' })
    await tabs[0]!.trigger('keydown', { key: 'Tab' })
    await tabs[1]!.trigger('click')
    await tabs[0]!.trigger('click')
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    Object.defineProperty(query, 'matches', { value: false })
    query.dispatchEvent(new Event('change'))
    await nextTick()
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    await wrapper.setProps({ selected: null })
    expect(wrapper.text()).toContain('Choose an episode to see its tracklist')
    wrapper.unmount()
  })
})
