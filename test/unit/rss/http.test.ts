import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFeedResponder,
  feedAliasResponse,
  isFeedAlias,
  matchesEtag,
} from '../../../server/rss/http.ts'
import { publicFeedArchive } from '../../../server/content/feed.ts'
import { createContentRepository } from '../../../server/content/repository.ts'
import { assertPodcastFeed } from '../../../tools/content/feed/assert.ts'
import { candidate, reader, runnableCatalog } from '../content/fixtures.ts'

const at = Date.parse('2026-09-08')
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('conditional feed delivery', () => {
  it('serves XML and stable validators for GET/HEAD and rejects other methods before reading', async () => {
    const value = publicFeedArchive(runnableCatalog(), at),
      read = vi.fn(async () => value),
      respond = createFeedResponder(read, () => at)
    const get = await respond('GET')
    expect(get.status).toBe(200)
    assertPodcastFeed(get.body, value)
    expect(get.headers.etag).toMatch(/^W\/"[a-f0-9]{64}"$/)
    expect(get.headers).toMatchObject({
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=60, must-revalidate',
      'x-content-type-options': 'nosniff',
    })
    expect(get.headers).not.toHaveProperty('last-modified')
    expect(await respond('HEAD')).toEqual({ ...get, body: '' })
    for (const method of ['GET', 'HEAD']) {
      for (const header of [
        get.headers.etag!,
        get.headers.etag!.slice(2),
        '*',
        `"old", ${get.headers.etag}`,
      ]) {
        expect(await respond(method, header)).toEqual({
          status: 304,
          headers: get.headers,
          body: '',
        })
      }
    }
    expect(await respond('GET', '"old"')).toEqual(get)
    read.mockClear()
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'get']) {
      expect(await respond(method, '*')).toMatchObject({
        status: 405,
        headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' },
      })
    }
    expect(read).not.toHaveBeenCalled()
  })

  it.each([
    [undefined, false],
    ['', false],
    [' ', false],
    ['*', true],
    [' \t* ', true],
    ['"current"', true],
    ['W/"current"', true],
    ['w/"current"', false],
    [' "old" , W/"current" ', true],
    ['"old,comma", "current"', true],
    ['"cur,rent"', false],
    ['"current", garbage', false],
    ['"current" "old"', false],
    ['*, "current"', false],
    ['"current', false],
    ['current', false],
    ['"current", *', false],
    ['"old"', false],
    [',, "current",,', true],
    ['"cur\trent"', false],
    ['"é", "current"', true],
    ['"😀", "current"', false],
  ] as const)(
    'parses If-None-Match %j without false 304s',
    (header, expected) => {
      expect(matchesEtag(header, 'W/"current"')).toBe(expected)
    },
  )

  it('changes the ETag only when visible rendered content changes, including publication boundaries', async () => {
    const source = runnableCatalog(),
      episode = source.episodes[0]!
    let time = at
    episode.publishedAt = '2026-09-08T00:00:01.000Z'
    const respond = createFeedResponder(
      async (asOf) => publicFeedArchive(source, asOf),
      () => time,
    )
    const initial = await respond('GET')
    episode.title = 'Hidden editorial change'
    expect((await respond('GET')).headers.etag).toBe(initial.headers.etag)
    source.episodes[1]!.tracks = []
    expect((await respond('GET')).headers.etag).toBe(initial.headers.etag)
    time++
    expect((await respond('GET')).body).toBe(initial.body)
    time = at + 1000
    const published = await respond('GET', initial.headers.etag)
    expect(published.status).toBe(200)
    expect(published.headers.etag).not.toBe(initial.headers.etag)
    episode.descriptionHtml = '<p>New visible description</p>'
    const edited = await respond('GET', published.headers.etag)
    expect(edited.status).toBe(200)
    expect(edited.headers.etag).not.toBe(published.headers.etag)
    expect(
      await createFeedResponder(
        async (asOf) => publicFeedArchive(source, asOf),
        () => time,
      )('GET'),
    ).toEqual(edited)
  })

  it('returns non-cacheable generic errors, including HEAD, and recovers failed catalog loads', async () => {
    const port = reader(),
      read = vi.spyOn(port, 'read'),
      log = vi.fn()
    const repo = createContentRepository(port, true),
      respond = createFeedResponder(
        (asOf) => repo.publicArchive(asOf),
        () => at,
        log,
      )
    read.mockRejectedValueOnce(new Error('/private/path failed'))
    const error = await respond('GET', '*')
    expect(error).toEqual({
      status: 503,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
      body: 'Feed temporarily unavailable.\n',
    })
    expect(log).toHaveBeenCalledOnce()
    expect((await respond('GET')).status).toBe(200)
    const broken = createFeedResponder(
      async () => {
        throw new Error('read')
      },
      () => at,
      log,
    )
    expect(await broken('HEAD', '*')).toEqual({ ...error, body: '' })
    const value = publicFeedArchive(runnableCatalog(), at)
    value.episodes[0]!.guid = '\ud800'
    expect(
      await createFeedResponder(
        async () => value,
        () => at,
        log,
      )('GET'),
    ).toEqual(error)
  })
})

describe('bounded legacy aliases', () => {
  it.each([
    '/feed/podcast/',
    '/?feed=podcast',
    '/?tracking=1&feed=podcast',
    '/feed/podcast/?x=1',
  ])('recognizes %s', (path) => {
    expect(isFeedAlias(new URL(path, 'https://example.com'))).toBe(true)
  })
  it.each([
    '/',
    '/?feed=other',
    '/?feed=Podcast',
    '/?feed=podcast&feed=podcast',
    '/?Feed=podcast',
    '/wp/?feed=podcast',
    '/wp/feed/podcast',
    '/episodes/a?feed=podcast',
    '/feed/podcast',
    '/feed/other/',
  ])('leaves %s alone', (path) => {
    expect(isFeedAlias(new URL(path, 'https://example.com'))).toBe(false)
  })
  it('redirects safe methods with a fixed relative target and rejects unsafe ones', () => {
    expect(feedAliasResponse('GET')).toMatchObject({
      status: 301,
      headers: {
        location: '/feed/podcast',
        'cache-control': 'public, max-age=60, must-revalidate',
      },
    })
    expect(feedAliasResponse('HEAD')).toEqual({
      ...feedAliasResponse('GET'),
      body: '',
    })
    expect(feedAliasResponse('POST')).toMatchObject({
      status: 405,
      headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' },
    })
  })
})

it('executes the thin Nitro handlers with real content, serialization and response application', async () => {
  vi.resetModules()
  vi.spyOn(Date, 'now').mockReturnValue(at)
  vi.stubGlobal('useStorage', () => ({
    getKeys: async () =>
      [...candidate.files.keys()].map((path) => path.replaceAll('/', ':')),
    getItem: reader().read,
  }))
  interface Event {
    method: string
    url: string
    validator?: string
    status?: number
    headers?: Record<string, string>
  }
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('getRequestHeader', (event: Event, name: string) => {
    expect(name).toBe('if-none-match')
    return event.validator
  })
  vi.stubGlobal(
    'getRequestURL',
    (event: Event) => new URL(event.url, 'https://untrusted.example'),
  )
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
    await import('../../../server/routes/feed/podcast.ts')
  const { default: middleware } =
    await import('../../../server/middleware/podcast-feed-alias.ts')
  const invoke = route as unknown as (event: Event) => Promise<string>
  const alias = middleware as unknown as (event: Event) => string | undefined
  const request: Event = { method: 'GET', url: '/feed/podcast' }
  const xml = await invoke(request)
  expect(request.status).toBe(200)
  assertPodcastFeed(xml, publicFeedArchive(runnableCatalog(), at))
  request.validator = request.headers!.etag
  expect(await invoke(request)).toBe('')
  expect(request.status).toBe(304)
  const redirect: Event = { method: 'HEAD', url: '/?feed=podcast' }
  expect(alias(redirect)).toBe('')
  expect(redirect.status).toBe(301)
  expect(alias({ method: 'GET', url: '/' })).toBeUndefined()
})
