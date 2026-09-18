import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPlaybackResponder } from '../../../server/playback/response'
import { byteRange } from '../../../server/http/byte-range'
import { fixture } from './fixtures'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playback-test-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
async function setup() {
  const f = fixture()
  await writeFile(join(root, 'test.mp3'), f.source)
  const log = vi.fn()
  const find = vi.fn(async () => ({ entry: f.entry, asset: f.asset }))
  const respond = createPlaybackResponder({
    root,
    find,
    header: async () => f.header,
    log,
  })
  const request = (headers = {}, method = 'GET') =>
    respond(
      '/playback/test',
      new Request('https://example.test/playback/test', { method, headers }),
    )
  return { ...f, respond, request, log, find }
}
async function bytes(body?: NodeJS.ReadableStream) {
  const chunks: Buffer[] = []
  if (body) for await (const chunk of body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

it('assembles full bytes and every boundary range from the unchanged MP3', async () => {
  const f = await setup()
  for (const [range, start, end] of [
    [undefined, 0, f.body.length - 1],
    ['bytes=0-7', 0, 7],
    ['bytes=20-27', 20, 27],
    ['bytes=24-', 24, f.body.length - 1],
    ['bytes=-5', f.body.length - 5, f.body.length - 1],
    ['bytes=2-999999', 2, f.body.length - 1],
    ['bytes=-999999', 0, f.body.length - 1],
  ] as const) {
    const response = await f.request(range ? { Range: range } : {})
    expect(response.status).toBe(range ? 206 : 200)
    expect(response.headers['content-length']).toBe(String(end - start + 1))
    expect(response.headers['content-type']).toBe('audio/mp4')
    expect(await bytes(response.body)).toEqual(f.body.subarray(start, end + 1))
  }
})
it('implements HEAD, validators, range errors and ignored malformed/multipart ranges', async () => {
  const f = await setup(),
    etag = `"${f.entry.virtual!.sha256}"`
  const head = await f.request({ Range: 'bytes=0-1' }, 'HEAD')
  expect(head.status).toBe(200)
  expect(head.body).toBeUndefined()
  expect(head.headers['content-length']).toBe(String(f.body.length))
  for (const validator of [etag, `W/${etag}`, '*', `"other", ${etag}`]) {
    const r = await f.request({ 'If-None-Match': validator })
    expect(r.status).toBe(304)
    expect(r.body).toBeUndefined()
  }
  expect(
    (await f.request({ Range: 'bytes=0-1', 'If-Range': etag })).status,
  ).toBe(206)
  for (const validator of [
    '"old"',
    `W/${etag}`,
    'Wed, 01 Jan 2020 00:00:00 GMT',
  ]) {
    const r = await f.request({ Range: 'bytes=0-1', 'If-Range': validator })
    expect(r.status).toBe(200)
    expect(await bytes(r.body)).toEqual(f.body)
  }
  for (const range of [
    'bytes=40-',
    'bytes=9-3',
    'bytes=-0',
    'bytes=99999999999999999-',
    'bytes=0-99999999999999999',
  ]) {
    const r = await f.request({ Range: range })
    expect(r.status).toBe(416)
    expect(r.headers['content-range']).toBe(`bytes */${f.body.length}`)
  }
  for (const range of ['bytes=0-1,3-4', 'nonsense', 'bytes=-']) {
    const r = await f.request({ Range: range, 'If-None-Match': '"old"' })
    expect(r.status).toBe(200)
    expect(await bytes(r.body)).toEqual(f.body)
  }
  expect((await f.request({}, 'POST')).status).toBe(405)
  expect(byteRange(null, 10)).toBeUndefined()
})
it('rejects missing/private mappings, wrong sources and symlink/path escapes', async () => {
  const f = await setup()
  f.find.mockResolvedValueOnce(undefined as never)
  expect((await f.request()).status).toBe(404)
  for (const change of [
    { sha256: '0'.repeat(64) },
    { byteLength: 1 },
    { kind: 'artwork' },
    { id: 'other' },
    { relativePath: '../outside.mp3' },
  ]) {
    f.find.mockResolvedValueOnce({
      entry: f.entry,
      asset: { ...f.asset, ...change },
    } as never)
    expect((await f.request()).status).toBe(503)
  }
  await rm(join(root, 'test.mp3'))
  expect((await f.request()).status).toBe(503)
  await writeFile(join(root, 'other.mp3'), f.source)
  await symlink(join(root, 'other.mp3'), join(root, 'test.mp3'))
  expect((await f.request()).status).toBe(503)
  await rm(join(root, 'test.mp3'))
  await writeFile(join(root, 'test.mp3'), 'short')
  expect((await f.request()).status).toBe(503)
  await rm(join(root, 'test.mp3'))
  await mkdir(join(root, 'test.mp3'))
  expect((await f.request()).status).toBe(503)
  expect(f.log).toHaveBeenCalled()
})
it('cancels file reads when the client abandons a stream before or during consumption', async () => {
  const f = await setup()
  const r = await f.request()
  r.body!.destroy()
  await new Promise<void>((resolve) => r.body!.on('close', resolve))
  const controller = new AbortController()
  const aborted = await f.respond(
    '/test',
    new Request('https://example.test/test', { signal: controller.signal }),
  )
  const closed = new Promise<void>((resolve) => {
    aborted.body!.on('error', () => {})
    aborted.body!.on('close', resolve)
  })
  controller.abort()
  await closed
  expect(aborted.body!.destroyed).toBe(true)
})
it('fails closed when a header is unavailable or the media root is not configured', async () => {
  const f = await setup()
  for (const [configured, status] of [
    ['', 404],
    [root, 503],
  ] as const) {
    const respond = createPlaybackResponder({
      root: configured,
      find: f.find,
      header: async () => {
        throw Error('bad header')
      },
    })
    expect(
      (await respond('/x', new Request('https://example.test/x'))).status,
    ).toBe(status)
  }
})
