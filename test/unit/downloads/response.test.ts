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
const request = (method = 'GET') =>
  new Request(
    'https://nurevolution.net/downloads/test?url=https://evil.example',
    {
      method,
      headers: {
        cookie: 'secret',
        authorization: 'secret',
        range: 'bytes=0-1',
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
    expect(response.headers.get('accept-ranges')).toBeNull()
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
