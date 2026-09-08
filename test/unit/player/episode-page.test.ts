import { describe, expect, it, vi } from 'vitest'
import {
  createEpisodeNavigation,
  episodeHead,
  formatDate,
  formatTime,
  loadEpisodePage,
  type EpisodePageState,
} from '../../../app/services/episode-page'
import {
  episodeDetail,
  episodeSummary,
  selectPublic,
  showPublic,
} from '../../../shared/content/public'
import { runnableCatalog } from '../content/fixtures'
const catalog = runnableCatalog()
const episodes = selectPublic(catalog, Date.parse('2026-09-08'))
const model = {
  show: showPublic(catalog),
  episodes: episodes.map((e) => episodeSummary(catalog, e)),
  selected: episodeDetail(catalog, episodes[0]!),
}
const state = (): EpisodePageState => ({
  model: null,
  path: '',
  pendingPath: null,
  failedPath: null,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('episode page loading and navigation', () => {
  it('loads only the requested or latest detail, and handles an empty archive', async () => {
    const reader = {
      show: async () => model.show,
      list: async () => ({ episodes: model.episodes }),
      detail: vi.fn(async () => model.selected),
    }
    expect(await loadEpisodePage(reader)).toEqual(model)
    expect(reader.detail).toHaveBeenCalledWith(model.selected.slug)
    await loadEpisodePage(reader, 'saved-slug')
    expect(reader.detail).toHaveBeenLastCalledWith('saved-slug')
    reader.list = async () => ({ episodes: [] })
    reader.detail.mockClear()
    expect((await loadEpisodePage(reader)).selected).toBeNull()
    expect(reader.detail).not.toHaveBeenCalled()
    reader.detail.mockRejectedValueOnce(new Error('not found'))
    await expect(loadEpisodePage(reader, 'missing')).rejects.toThrow(
      'not found',
    )
  })
  it('commits only the latest accepted route and isolates sessions', async () => {
    const s = state(),
      a = deferred<typeof model>(),
      b = deferred<typeof model>()
    const load = vi
      .fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise)
    const nav = createEpisodeNavigation(s, load)
    const first = nav.prepare('/a'),
      second = nav.prepare('/b')
    b.resolve(model)
    expect(await second).toBe(true)
    expect(s.model).toBeNull()
    nav.complete('/a')
    expect(s.model).toBeNull()
    nav.complete('/b')
    expect(s.model).toEqual(model)
    a.resolve(model)
    expect(await first).toBe(false)
    expect(s.path).toBe('/b')
    expect(state().model).toBeNull()
  })
  it('preserves the prior model on failure and ignores obsolete failures', async () => {
    const s = { ...state(), model },
      a = deferred<typeof model>()
    const load = vi
      .fn()
      .mockReturnValueOnce(a.promise)
      .mockResolvedValueOnce(model)
      .mockRejectedValueOnce(new Error('unavailable'))
    const nav = createEpisodeNavigation(s, load)
    const old = nav.prepare('/old')
    await nav.prepare('/new')
    nav.complete('/new', true)
    a.reject(new Error('old'))
    expect(await old).toBe(false)
    await expect(nav.prepare('/failed')).rejects.toThrow('unavailable')
    expect(s).toMatchObject({
      model,
      path: '',
      pendingPath: null,
      failedPath: '/failed',
    })
  })
  it('derives canonical metadata from the configured origin and escaped bindings', () => {
    expect(episodeHead(model, '/')).toMatchObject({
      title: 'Nurevolution — Podcast archive',
      link: [
        { rel: 'canonical', href: 'https://nurevolution.net/' },
        { rel: 'alternate', href: model.show.feedUrl },
      ],
    })
    expect(episodeHead(model, model.selected.path).title).toContain(
      model.selected.title,
    )
    expect(
      episodeHead({ ...model, selected: null }, '/').meta[0]!.content,
    ).toBe(model.show.descriptionText)
  })
  it('formats UTC dates and optional exact timestamps consistently', () => {
    expect(formatDate('2020-05-09T06:02:57.000Z')).toBe('May 9, 2020')
    expect(formatDate(null)).toBe('')
    expect([null, -1, Infinity].map(formatTime)).toEqual(
      Array(3).fill('Duration unavailable'),
    )
    expect([0, 62.9, 3601.2].map(formatTime)).toEqual([
      '0:00',
      '1:02',
      '1:00:01',
    ])
  })
})
