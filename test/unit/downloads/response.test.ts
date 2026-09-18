import { describe, expect, it, vi } from 'vitest'
import { createDownloadResponder } from '../../../server/downloads/response'
import { attachment } from '../../../server/downloads/filename'
import { createLegacyResponder } from '../../../server/pages/legacy'
import { createContentRepository } from '../../../server/content/repository'
import { reader, runnableCatalog } from '../content/fixtures'
import { episodeDetail } from '../../../shared/content/public'
const catalog = runnableCatalog()
const episode = episodeDetail(
  catalog,
  catalog.episodes.find((e) => e.id === 'wp-311')!,
)
const bytes = new Uint8Array([1, 2, 3, 4])
const fixture = {
  ...episode,
  audio: { ...episode.audio, byteLength: bytes.length },
}
const request = (method = 'GET', headers: Record<string, string> = {}) =>
  new Request(
    'https://nurevolution.net/downloads/test?url=https://evil.example',
    {
      method,
      headers: {
        cookie: 'secret',
        authorization: 'secret',
        ...headers,
      },
    },
  )
const success = (body: BodyInit | null = bytes) =>
  new Response(body, {
    headers: { 'content-type': 'audio/mpeg', 'content-length': '4' },
  })

describe('bounded attachment streaming', () => {
  it('streams unchanged bytes with a real filename and ignores request-controlled upstream inputs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(success())
    const find = vi.fn(async () => fixture)
    const respond = createDownloadResponder(find, { fetch, now: () => 123 })
    const response = await respond('saved', request())
    expect(find).toHaveBeenCalledWith('saved', 123)
    expect(fetch).toHaveBeenCalledWith(
      episode.audio.url,
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: { 'Accept-Encoding': 'identity' },
        signal: expect.any(AbortSignal),
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-disposition')).toBe(
      attachment(episode.audio.downloadFilename),
    )
    expect(response.headers.get('content-length')).toBe('4')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })
  it('returns HEAD metadata without consuming a body and rejects methods/lookups before fetch', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(success(null))
    const find = vi.fn(async (): Promise<typeof fixture | undefined> => fixture)
    const respond = createDownloadResponder(find, { fetch })
    const head = await respond('a', request('HEAD'))
    expect(await head.text()).toBe('')
    expect(head.headers.get('content-length')).toBe('4')
    expect(fetch.mock.calls[0]![1]!.method).toBe('HEAD')
    expect((await respond('a', request('POST'))).status).toBe(405)
    expect(find).toHaveBeenCalledOnce()
    find.mockResolvedValue(undefined)
    expect((await respond('missing', request())).status).toBe(404)
    expect(await (await respond('missing', request('HEAD'))).text()).toBe('')
    expect(fetch).toHaveBeenCalledOnce()
  })
  it.each([
    ['bytes=0-1', 0, 1],
    ['bytes=1-2', 1, 2],
    ['bytes=2-', 2, 3],
    ['bytes=-2', 2, 3],
    ['bytes=1-999', 1, 3],
    ['bytes=-999', 0, 3],
  ])(
    'serves the exact requested bytes for %s without forwarding credentials',
    async (range, start, end) => {
      const partial = bytes.slice(start, end + 1)
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(partial, {
          status: 206,
          headers: {
            'content-type': 'audio/mpeg',
            'content-length': String(partial.length),
            'content-range': `bytes ${start}-${end}/4`,
          },
        }),
      )
      const respond = createDownloadResponder(async () => fixture, { fetch })
      const response = await respond('saved', request('GET', { range }))
      expect(response.status).toBe(206)
      expect(response.headers.get('content-range')).toBe(
        `bytes ${start}-${end}/4`,
      )
      expect(response.headers.get('accept-ranges')).toBe('bytes')
      expect(response.headers.get('content-length')).toBe(
        String(partial.length),
      )
      expect(response.headers.get('content-disposition')).toBe(
        attachment(episode.audio.downloadFilename),
      )
      expect(fetch.mock.calls[0]![1]!.headers).toEqual({
        'Accept-Encoding': 'identity',
        Range: `bytes=${start}-${end}`,
      })
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(partial)
    },
  )
  it('returns 416 for unsatisfiable ranges before fetching and keeps missing episodes private', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const respond = createDownloadResponder(
      async (slug) => (slug === 'missing' ? undefined : fixture),
      { fetch },
    )
    for (const range of [
      'bytes=4-',
      'bytes=3-1',
      'bytes=-0',
      'bytes=999999999999999999999-',
    ]) {
      const response = await respond('saved', request('GET', { range }))
      expect(response.status).toBe(416)
      expect(response.headers.get('content-range')).toBe('bytes */4')
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    const missing = await respond(
      'missing',
      request('GET', { range: 'bytes=4-' }),
    )
    expect(missing.status).toBe(404)
    expect(missing.headers.get('content-range')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    ['GET', { range: 'items=0-1' }],
    ['GET', { range: 'bytes=garbage' }],
    ['GET', { range: 'bytes=0-1,2-3' }],
    ['GET', { range: 'bytes=0-1', 'if-range': '"old"' }],
    [
      'GET',
      { range: 'bytes=99-', 'if-range': 'Wed, 01 Jan 2020 00:00:00 GMT' },
    ],
    ['HEAD', { range: 'bytes=0-1' }],
  ] as const)(
    'serves full metadata/bytes for %s %j when a range is ignored',
    async (method, headers) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(success(method === 'HEAD' ? null : bytes))
      const response = await createDownloadResponder(async () => fixture, {
        fetch,
      })('saved', request(method, headers))
      expect(response.status).toBe(200)
      expect(response.headers.get('content-range')).toBeNull()
      expect(response.headers.get('content-length')).toBe('4')
      expect(fetch.mock.calls[0]![1]!.headers).toEqual({
        'Accept-Encoding': 'identity',
      })
      expect((await response.arrayBuffer()).byteLength).toBe(
        method === 'HEAD' ? 0 : 4,
      )
    },
  )
  it.each([
    { status: 200, range: null, length: '4' },
    { status: 206, range: null, length: '2' },
    { status: 206, range: 'bytes 1-2/4', length: '2' },
    { status: 206, range: 'bytes 0-1/5', length: '2' },
    { status: 206, range: 'bytes 0-1/4', length: '4' },
  ])(
    'rejects incorrect partial response metadata: %j',
    async ({ status, range, length }) => {
      const headers = new Headers({
        'content-type': 'audio/mpeg',
        'content-length': length,
      })
      if (range) headers.set('content-range', range)
      const upstream = new Response(bytes, { status, headers })
      const cancel = vi.spyOn(upstream.body!, 'cancel')
      const response = await createDownloadResponder(async () => fixture, {
        fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(upstream),
        log: vi.fn(),
      })('saved', request('GET', { range: 'bytes=0-1' }))
      expect(response.status).toBe(502)
      expect(response.headers.get('content-range')).toBeNull()
      expect(cancel).toHaveBeenCalled()
    },
  )
  it.each([new Uint8Array([1]), new Uint8Array([1, 2, 3])])(
    'rejects partial bodies whose bytes disagree with the selected length',
    async (body) => {
      const response = await createDownloadResponder(async () => fixture, {
        fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
          new Response(body, {
            status: 206,
            headers: {
              'content-type': 'audio/mpeg',
              'content-length': '2',
              'content-range': 'bytes 0-1/4',
            },
          }),
        ),
        log: vi.fn(),
      })('saved', request('GET', { range: 'bytes=0-1' }))
      expect(response.status).toBe(206)
      await expect(response.arrayBuffer()).rejects.toThrow(/download/i)
    },
  )
  it.each<ResponseInit>([
    { status: 404 },
    { headers: { 'content-type': 'text/html', 'content-length': '4' } },
    { headers: { 'content-type': 'audio/mpeg' } },
    { headers: { 'content-type': 'audio/mpeg', 'content-length': '3' } },
    {
      headers: {
        'content-type': 'audio/mpeg',
        'content-length': '4',
        'content-encoding': 'gzip',
      },
    },
  ])('fails closed for incorrect upstream metadata: %j', async (init) => {
    const log = vi.fn()
    const respond = createDownloadResponder(async () => fixture, {
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(bytes, init)),
      log,
    })
    const result = await respond('a', request())
    expect(result.status).toBe(502)
    expect(result.headers.get('content-disposition')).toBeNull()
    expect(log).toHaveBeenCalledOnce()
  })
  it('rejects disallowed origins, credentials, invalid filenames, missing bodies and transport errors', async () => {
    const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(success(null)),
      log = vi.fn()
    for (const audio of [
      { ...fixture.audio, url: 'https://evil.example/a.mp3' },
      {
        ...fixture.audio,
        url: 'https://user:pass@podcast.nurevolution.net/a.mp3',
      },
      { ...fixture.audio, downloadFilename: '../bad.mp3' },
    ]) {
      const result = await createDownloadResponder(
        async () => ({ ...fixture, audio }),
        { fetch, log },
      )('a', request())
      expect(result.status).toBe(502)
    }
    expect(fetch).not.toHaveBeenCalled()
    const respond = createDownloadResponder(async () => fixture, { fetch, log })
    expect((await respond('a', request())).status).toBe(502)
    fetch.mockRejectedValueOnce(new Error('redirect rejected'))
    expect((await respond('a', request('HEAD'))).status).toBe(502)
  })
  it('times out header acquisition and forwards downstream cancellation', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init!.signal!.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          ),
      )
    const respond = createDownloadResponder(async () => fixture, {
      fetch,
      timeoutMs: 5,
      log: vi.fn(),
    })
    expect((await respond('a', request())).status).toBe(504)
    const abort = new AbortController()
    const pending = respond(
      'a',
      new Request('https://nurevolution.net/downloads/a', {
        signal: abort.signal,
      }),
    )
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(2)
    abort.abort()
    expect((await pending).status).toBe(502)
  })
  it('delivers initial chunks before upstream completion and aborts a canceled transfer', async () => {
    let enqueue!: ReadableStreamDefaultController<Uint8Array>
    const canceled = vi.fn()
    const upstream = new ReadableStream<Uint8Array>({
      start(output) {
        enqueue = output
        output.enqueue(bytes.slice(0, 2))
      },
      cancel: canceled,
    })
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(success(upstream))
    const respond = createDownloadResponder(async () => fixture, { fetch })
    const result = await respond('a', request()),
      output = result.body!.getReader()
    expect((await output.read()).value).toEqual(bytes.slice(0, 2))
    enqueue.enqueue(bytes.slice(2))
    expect((await output.read()).value).toEqual(bytes.slice(2))
    await output.cancel('left page')
    expect(canceled).toHaveBeenCalled()
    expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true)
  })
  it.each([new Uint8Array([1]), new Uint8Array([1, 2, 3, 4, 5])])(
    'terminates a truncated or oversized body',
    async (body) => {
      const log = vi.fn()
      const response = await createDownloadResponder(async () => fixture, {
        fetch: vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(success(body)),
        log,
      })('a', request())
      await expect(response.arrayBuffer()).rejects.toThrow(/download/i)
      expect(log).toHaveBeenCalled()
    },
  )
  it('terminates an upstream stream error after sending headers', async () => {
    const body = new ReadableStream({
      start(output) {
        output.error(new Error('connection lost'))
      },
    })
    const response = await createDownloadResponder(async () => fixture, {
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(success(body)),
      log: vi.fn(),
    })('a', request())
    expect(response.status).toBe(200)
    await expect(response.arrayBuffer()).rejects.toThrow('connection lost')
  })
})

describe('filenames and historical paths', () => {
  it('formats ASCII, Unicode and punctuation safely without URL decoding', () => {
    expect(attachment("bouche_d'incendie.mp3")).toContain(
      "filename*=UTF-8''bouche_d%27incendie.mp3",
    )
    expect(attachment('épisode "100%".mp3')).toContain(
      'filename="_pisode \\"100%\\".mp3"',
    )
    expect(attachment('épisode.mp3')).toContain('%C3%A9pisode.mp3')
    for (const value of ['', '.', '..', '../a', 'a\\b', 'a\r\nb', 'a\0b'])
      expect(() => attachment(value)).toThrow('basename')
  })
  it('resolves every exact historical mapping and one trailing slash through public selection', async () => {
    const repo = createContentRepository(reader(), true)
    for (const entry of catalog.legacyUrls) {
      const path = new URL(entry.url).pathname
      const expected = `/episodes/${catalog.episodes.find((e) => e.id === entry.episodeId)!.slug}`
      expect(await repo.legacyPath(path, Date.parse('2026-09-08'))).toBe(
        expected,
      )
      expect(await repo.legacyPath(`${path}/`, Date.parse('2026-09-08'))).toBe(
        expected,
      )
      expect(
        await repo.legacyPath(`${path}//`, Date.parse('2026-09-08')),
      ).toBeUndefined()
    }
    expect(
      await repo.legacyPath('/podcast/unknown', Date.now()),
    ).toBeUndefined()
    expect(
      await repo.legacyPath('/podcast/trey_turner-praxis', 0),
    ).toBeUndefined()
  })
  it('serves one-hop GET/HEAD redirects, honest failures, and unsupported-method responses', async () => {
    const find = vi.fn(
        async (): Promise<string | undefined> => '/episodes/saved',
      ),
      log = vi.fn()
    const respond = createLegacyResponder(find, () => 123, log)
    expect(await respond('GET', '/podcast/old')).toMatchObject({
      status: 301,
      headers: { location: '/episodes/saved' },
    })
    expect(await respond('HEAD', '/podcast/old')).toMatchObject({
      status: 301,
      body: '',
    })
    expect(await respond('POST', '/podcast/old')).toMatchObject({
      status: 405,
      headers: { allow: 'GET, HEAD' },
    })
    find.mockResolvedValue(undefined)
    expect(await respond('GET', '/podcast/missing')).toMatchObject({
      status: 404,
    })
    find.mockRejectedValue(new Error('unavailable'))
    expect(await respond('GET', '/podcast/old')).toMatchObject({ status: 503 })
    expect(await respond('HEAD', '/podcast/old')).toMatchObject({
      status: 503,
      body: '',
    })
  })
})
