import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { serializeChapters } from '../../../shared/content/chapters.ts'
import { episodeDetail, selectPublic } from '../../../shared/content/public.ts'
import { chapterDocument } from '../../../server/chapters/document.ts'
import { createChapterResponder } from '../../../server/chapters/http.ts'
import { candidate, reader, runnableCatalog } from '../content/fixtures.ts'

const at = Date.parse('2026-09-18')
const catalog = runnableCatalog()
const episode = episodeDetail(
  catalog,
  catalog.episodes.find((e) => e.id === 'wp-417')!,
)
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('preserves exact known starts and original numbering without inventing missing cuts', () => {
  const tracks = [null, 7695011 / 44100, null, 33019949 / 44100].map(
    (startTime, i) => ({
      position: i + 1,
      artist: 'Artist "quoted"',
      title: 'A & B <live>',
      startTime,
    }),
  )
  const document = chapterDocument({ tracks })!
  expect(JSON.parse(document.body)).toEqual({
    version: '1.2.0',
    chapters: [
      {
        startTime: 7695011 / 44100,
        title: '02. Artist "quoted" - A & B <live>',
      },
      {
        startTime: 33019949 / 44100,
        title: '04. Artist "quoted" - A & B <live>',
      },
    ],
  })
  expect(document.sha256).toBe(
    createHash('sha256').update(document.body).digest('hex'),
  )
  expect(document.etag).toBe(`W/"${document.sha256}"`)
  expect(chapterDocument({ tracks })).toEqual(document)
  expect(chapterDocument({ tracks: [] })).toBeNull()
  expect(
    serializeChapters(tracks.map((t) => ({ ...t, startTime: null }))),
  ).toBeNull()
  for (const startTime of [-1, Infinity, NaN, 0])
    expect(() =>
      serializeChapters([
        { position: 1, artist: 'A', title: 'T', startTime: 0 },
        { position: 2, artist: 'A', title: 'T', startTime },
      ]),
    ).toThrow(/Chapter starts/)
})

it('returns stable chapter bytes, weak validators, CORS and identical GET/HEAD metadata', async () => {
  const find = vi.fn(async () => episode)
  const respond = createChapterResponder(find, () => at)
  const get = await respond(episode.slug, 'GET')
  expect(find).toHaveBeenCalledExactlyOnceWith(episode.slug, at)
  expect(get).toMatchObject({
    status: 200,
    headers: {
      'content-type': 'application/json+chapters; charset=utf-8',
      'cache-control': 'public, max-age=60, must-revalidate',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'ETag',
    },
  })
  expect(get.body).toBe(serializeChapters(episode.tracks))
  expect(await respond(episode.slug, 'HEAD')).toEqual({ ...get, body: '' })
  for (const method of ['GET', 'HEAD'])
    for (const tag of [
      get.headers.etag!,
      get.headers.etag!.slice(2),
      '*',
      `"older", ${get.headers.etag}`,
    ]) {
      expect(await respond(episode.slug, method, tag)).toEqual({
        status: 304,
        headers: get.headers,
        body: '',
      })
    }
  expect(await respond(episode.slug, 'GET', '"unrelated"')).toEqual(get)
  find.mockClear()
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS'])
    expect(await respond(episode.slug, method, '*')).toMatchObject({
      status: 405,
      headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' },
    })
  expect(find).not.toHaveBeenCalled()
})

it('rechecks publication at request time and never returns 304 for private, unknown, or untimed episodes', async () => {
  const source = runnableCatalog()
  const item = source.episodes.find((e) => e.id === episode.id)!
  let now = at
  item.publishedAt = new Date(at + 1000).toISOString()
  const find = async (slug: string, asOf: number) => {
    const item = selectPublic(source, asOf).find((e) => e.slug === slug)
    return item ? episodeDetail(source, item) : undefined
  }
  const respond = createChapterResponder(find, () => now)
  for (const slug of [item.slug, 'unknown'])
    expect(await respond(slug, 'GET', '*')).toMatchObject({
      status: 404,
      headers: { 'cache-control': 'no-store' },
      body: 'Chapters not found.\n',
    })
  now += 1000
  const published = await respond(item.slug, 'GET')
  expect(published.status).toBe(200)
  item.tracks[1]!.title += ' corrected'
  const corrected = await respond(item.slug, 'GET', published.headers.etag)
  expect(corrected.status).toBe(200)
  expect(corrected.headers.etag).not.toBe(published.headers.etag)
  item.status = 'draft'
  expect(
    await respond(item.slug, 'HEAD', corrected.headers.etag),
  ).toMatchObject({ status: 404, body: '' })
  item.status = 'published'
  item.tracks = []
  expect((await respond(item.slug, 'GET', '*')).status).toBe(404)
})

it('returns generic non-cacheable errors for read and serialization failures', async () => {
  const log = vi.fn()
  for (const find of [
    async () => {
      throw Error('/private/path')
    },
    async () => ({
      ...episode,
      tracks: [{ ...episode.tracks[0]!, startTime: NaN }],
    }),
  ]) {
    const respond = createChapterResponder(find, () => at, log)
    expect(await respond(episode.slug, 'GET', '*')).toMatchObject({
      status: 503,
      headers: { 'cache-control': 'no-store' },
      body: 'Chapters temporarily unavailable.\n',
    })
    expect(await respond(episode.slug, 'HEAD', '*')).toMatchObject({
      status: 503,
      body: '',
    })
  }
  expect(log).toHaveBeenCalledTimes(4)
})

it('executes the Nitro handler against the real content repository', async () => {
  vi.resetModules()
  vi.spyOn(Date, 'now').mockReturnValue(at)
  vi.stubGlobal('useStorage', () => ({
    getKeys: async () =>
      [...candidate.files.keys()].map((path) => path.replaceAll('/', ':')),
    getItem: reader().read,
  }))
  type Event = {
    method: string
    file?: string
    validator?: string
    status?: number
    headers?: Record<string, string>
  }
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('getRouterParam', (event: Event, name: string) => {
    expect(name).toBe('file')
    return event.file
  })
  vi.stubGlobal('getRequestHeader', (event: Event) => event.validator)
  vi.stubGlobal('setResponseStatus', (event: Event, status: number) => {
    event.status = status
  })
  vi.stubGlobal(
    'setResponseHeaders',
    (event: Event, headers: Record<string, string>) => {
      event.headers = headers
    },
  )
  const { default: route } =
    await import('../../../server/routes/chapters/[file].ts')
  const respond = route as unknown as (event: Event) => Promise<string>
  const event: Event = { method: 'GET', file: episode.slug + '.json' }
  expect(await respond(event)).toBe(serializeChapters(episode.tracks))
  expect(event.status).toBe(200)
  event.validator = event.headers!.etag
  expect(await respond(event)).toBe('')
  expect(event.status).toBe(304)
  const missing: Event = { method: 'HEAD' }
  expect(await respond(missing)).toBe('')
  expect(missing.status).toBe(404)
})
