import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createContentRepository,
  readCatalog,
} from '../../../server/content/repository.ts'
import { candidate, reader } from './fixtures.ts'

afterEach(() => vi.unstubAllGlobals())

describe('content document loading and public repository', () => {
  it('loads complete documents and fails for missing, unknown, invalid or unreadable content', async () => {
    expect((await readCatalog(reader())).catalog).toEqual(candidate.catalog)
    await expect(
      readCatalog({ ...reader(), list: async () => [] }),
    ).rejects.toThrow('Missing content')
    await expect(
      readCatalog({ ...reader(), list: async () => ['secret.txt'] }),
    ).rejects.toThrow('Unexpected content')
    await expect(
      readCatalog({
        ...reader(),
        read: async () => {
          throw new Error('broken JSON')
        },
      }),
    ).rejects.toThrow('cannot read content')
    await expect(
      readCatalog({ ...reader(), read: async () => null }),
    ).rejects.toThrow()
  })
  it('caches validated production data, returns fresh DTOs and uses the same filter for list/lookup/archive', async () => {
    const port = reader(),
      spy = vi.spyOn(port, 'list'),
      repo = createContentRepository(port, true),
      at = Date.parse('2026-09-08')
    expect(await repo.list(at)).toHaveLength(55)
    const episode = await repo.find('trey-turner-praxis', at)
    expect(episode!.tracks).toHaveLength(21)
    episode!.tracks[0]!.title = 'edited DTO'
    expect((await repo.find('trey-turner-praxis', at))!.tracks[0]!.title).toBe(
      'Chariots',
    )
    expect(
      await repo.find('trey-turner-praxis', Date.parse('2015-01-01')),
    ).toBeUndefined()
    expect(await repo.find('../../show.json', at)).toBeUndefined()
    expect(await repo.show()).toMatchObject({ title: 'nurevolution studios' })
    const archive = await repo.publicArchive(at)
    expect(archive.episodes.map((e) => e.id)).toEqual(
      (await repo.list(at)).map((e) => e.id),
    )
    expect(archive.show).toEqual(await repo.show())
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('refreshes development content and permits recovery after a failed load', async () => {
    const port = reader(),
      spy = vi.spyOn(port, 'list'),
      repo = createContentRepository(port, false)
    await repo.show()
    await repo.show()
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRejectedValueOnce(new Error('unavailable'))
    const production = createContentRepository(port, true)
    await expect(production.show()).rejects.toThrow('unavailable')
    expect(await production.show()).toHaveProperty('title')
  })
  it('withholds synthetic drafts and future entries identically in detail and list', async () => {
    const port = reader(),
      originalRead = port.read
    port.read = async (path) => {
      const value = await originalRead(path)
      if (path === 'episodes/wp-417.json')
        return {
          ...candidate.catalog.episodes.find((e) => e.id === 'wp-417'),
          status: 'draft',
        }
      if (path === 'episodes/wp-484.json')
        return {
          ...candidate.catalog.episodes.find((e) => e.id === 'wp-484'),
          publishedAt: '2099-01-01T00:00:00.000Z',
        }
      return value
    }
    const repo = createContentRepository(port, true),
      at = Date.parse('2026-09-08')
    expect(await repo.list(at)).toHaveLength(53)
    expect(await repo.find('trey-turner-praxis', at)).toBeUndefined()
    expect(await repo.find('trey-turner-ruminate', at)).toBeUndefined()
  })
})

it('binds Nitro assets and thin handlers to the real repository, including uniform 404s', async () => {
  vi.resetModules()
  vi.stubGlobal('useStorage', (name: string) => {
    expect(name).toBe('assets:content')
    return {
      getKeys: async () =>
        [...candidate.files.keys()].map((path) => path.replaceAll('/', ':')),
      getItem: reader().read,
    }
  })
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('getRouterParam', (event: { slug?: string }) => event.slug)
  vi.stubGlobal(
    'createError',
    (options: { statusCode: number; statusMessage: string }) =>
      Object.assign(new Error(options.statusMessage), options),
  )
  const { default: show } = await import('../../../server/api/show.get.ts')
  const { default: list } =
    await import('../../../server/api/episodes/index.get.ts')
  const { default: detail } =
    await import('../../../server/api/episodes/[slug].get.ts')
  // The globals above supply the event boundary; handler arguments never reach storage paths.
  const invokeShow = show as unknown as () => Promise<unknown>
  const invokeList = list as unknown as () => Promise<{ episodes: unknown[] }>
  const invokeDetail = detail as unknown as (event: {
    slug?: string
  }) => Promise<unknown>
  expect(await invokeShow()).toHaveProperty(
    'feedUrl',
    'https://nurevolution.net/feed/podcast',
  )
  expect((await invokeList()).episodes).toHaveLength(55)
  expect(await invokeDetail({ slug: 'trey-turner-praxis' })).toHaveProperty(
    'id',
    'wp-417',
  )
  await expect(invokeDetail({ slug: 'unknown' })).rejects.toHaveProperty(
    'statusCode',
    404,
  )
  await expect(invokeDetail({})).rejects.toHaveProperty('statusCode', 404)
})
