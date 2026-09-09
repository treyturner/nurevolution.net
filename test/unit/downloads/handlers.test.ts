import { Writable } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { candidate, reader, runnableCatalog } from '../content/fixtures'

interface Event {
  method: string
  slug?: string
  path: string
  node: { res: Writable }
  status?: number
  headers?: Record<string, string>
}
const event = (method = 'HEAD', slug?: string): Event => ({
  method,
  slug,
  path: '/downloads/test',
  node: {
    res: new Writable({
      write(_chunk, _encoding, done) {
        done()
      },
    }),
  },
})
function globals() {
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('getRouterParam', (e: Event) => e.slug)
  vi.stubGlobal(
    'getRequestURL',
    (e: Event) => new URL(e.path, 'https://nurevolution.net'),
  )
  vi.stubGlobal('setResponseStatus', (e: Event, status: number) => {
    e.status = status
  })
  vi.stubGlobal(
    'setResponseHeaders',
    (e: Event, headers: Record<string, string>) => {
      e.headers = headers
    },
  )
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('writes through Node backpressure, cancels disconnected transfers, and closes failed bodies', async () => {
  globals()
  const { downloadHandler } = await import('../../../server/downloads/handler')
  let captured: Request | undefined
  const respond = vi.fn(async (_slug: string, request: Request) => {
    captured = request
    return new Response('bytes')
  })
  const invoke = downloadHandler(respond) as unknown as (
    e: Event,
  ) => Promise<void>
  const first = event('GET', 'saved')
  const writes: Buffer[] = []
  let drain!: () => void
  first.node.res = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, done) {
      writes.push(chunk)
      drain = done
    },
  })
  let complete = false
  const pending = invoke(first).then(() => {
    complete = true
  })
  await vi.waitFor(() => expect(writes).toHaveLength(1))
  expect(complete).toBe(false)
  expect(captured!.signal.aborted).toBe(false)
  drain()
  await pending
  expect(Buffer.concat(writes).toString()).toBe('bytes')
  expect(captured!.signal.aborted).toBe(false)
  const second = event('GET')
  second.node.res = new Writable({
    write() {
      this.destroy()
    },
  })
  await invoke(second)
  expect(captured!.signal.aborted).toBe(true)
  expect(second.node.res.destroyed).toBe(true)
  expect(respond).toHaveBeenLastCalledWith('', expect.any(Request))
  respond.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        start(output) {
          output.error(new Error('upstream lost'))
        },
      }),
    ),
  )
  const third = event('GET')
  await invoke(third)
  expect(third.node.res.destroyed).toBe(true)
  const fourth = event('HEAD')
  await invoke(fourth)
  expect(fourth.node.res.writableEnded).toBe(true)
  respond.mockRejectedValueOnce(new Error('preparation failed'))
  const last = event()
  await expect(invoke(last)).rejects.toThrow('preparation failed')
  expect(last.node.res.listenerCount('close')).toBe(0)
})

it('binds production download and redirect routes to all canonical assets and public lookups', async () => {
  vi.resetModules()
  globals()
  const catalog = runnableCatalog()
  vi.stubGlobal('useStorage', () => ({
    getKeys: async () =>
      [...candidate.files.keys()].map((path) => path.replaceAll('/', ':')),
    getItem: reader().read,
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const asset = catalog.assets.find((value) => value.url === url)!
      return new Response(null, {
        headers: {
          'content-type': asset.mediaType,
          'content-length': String(asset.byteLength),
        },
      })
    }),
  )
  const { default: download } =
    await import('../../../server/routes/downloads/[slug]')
  const invoke = download as unknown as (e: Event) => Promise<void>
  for (const episode of catalog.episodes) {
    const e = event('HEAD', episode.slug)
    await invoke(e)
    expect(e.status).toBe(200)
    expect(e.headers!['content-disposition']).toContain('attachment;')
  }
  const missing = event('GET')
  await invoke(missing)
  expect(missing.status).toBe(404)
  const { default: redirect } =
    await import('../../../server/routes/podcast/[...path]')
  const move = redirect as unknown as (e: Event) => Promise<string>
  const first = event('GET')
  first.path = new URL(catalog.legacyUrls[0]!.url).pathname + '?ref=old'
  expect(await move(first)).toContain('Moved permanently')
  expect(first.status).toBe(301)
  expect(first.headers!.location).toMatch(/^\/episodes\//)
})
