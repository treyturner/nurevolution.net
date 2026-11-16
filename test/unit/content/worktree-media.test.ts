import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { createWorktreeMedia } from '../../../server/dev/worktree-media.ts'
import { runnableCatalog } from './fixtures.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true })
})
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')
async function fixture() {
  const root = await fs.mkdtemp(resolve(tmpdir(), 'worktree-media-'))
  roots.push(root)
  const catalog = runnableCatalog()
  const bytes = Buffer.from('0123456789')
  const artwork = Buffer.from('original cover')
  const audio = {
    id: 'audio-test',
    kind: 'audio' as const,
    sourceRoot: 'audio' as const,
    relativePath: 'New Mix.mp3',
    url: 'https://podcast.nurevolution.net/New%20Mix.mp3',
    mediaType: 'audio/mpeg' as const,
    byteLength: bytes.length,
    sha256: hash(bytes),
  }
  const cover = {
    ...audio,
    id: 'cover-test',
    kind: 'artwork' as const,
    sourceRoot: 'uploads' as const,
    relativePath: '2026/cover.png',
    url: 'https://nurevolution.net/wp/wp-content/uploads/2026/cover.png',
    mediaType: 'image/png' as const,
    byteLength: artwork.length,
    sha256: hash(artwork),
  }
  catalog.assets = [audio, cover]
  catalog.show.standardArtworkAssetId = catalog.show.itunesArtworkAssetId =
    cover.id
  catalog.episodes = [
    {
      ...catalog.episodes[0]!,
      audioAssetId: audio.id,
      artworkAssetId: cover.id,
    },
  ]
  await fs.mkdir(resolve(root, '.local/incoming/uploads'), { recursive: true })
  let now = Date.now()
  const respond = createWorktreeMedia(
    root,
    async () => catalog,
    () => now,
  )
  const audioPath = '/__dev/assets/audio/New%20Mix.mp3'
  const coverPath = '/__dev/assets/artwork/wp/wp-content/uploads/2026/cover.png'
  const request = (
    path = audioPath,
    method = 'GET',
    headers: HeadersInit = {},
  ) =>
    respond(path, new Request('http://localhost' + path, { method, headers }))
  const save = () =>
    fs.writeFile(resolve(root, '.local/incoming/New Mix.mp3'), bytes)
  return {
    root,
    catalog,
    bytes,
    artwork,
    audio,
    cover,
    request,
    save,
    audioPath,
    coverPath,
    advance: () => {
      now += 1100
    },
  }
}
async function body(
  response: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['request']>>,
) {
  const chunks: Buffer[] = []
  if (response.body)
    for await (const chunk of response.body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

it('serves originals from ignored worktree folders with HEAD and seekable byte ranges', async () => {
  const f = await fixture()
  await f.save()
  await fs.writeFile(
    resolve(f.root, '.local/incoming/uploads/cover.png'),
    f.artwork,
  )
  const full = await f.request()
  expect(full.status).toBe(200)
  expect(full.headers).toMatchObject({
    'content-type': 'audio/mpeg',
    'content-length': '10',
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  })
  expect(await body(full)).toEqual(f.bytes)
  const download = await f.request(
    '/downloads/' + f.catalog.episodes[0]!.slug,
    'GET',
    { range: 'bytes=2-4' },
  )
  expect(download.status).toBe(206)
  expect(download.headers).toMatchObject({
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="New Mix.mp3"; filename*=UTF-8''New%20Mix.mp3`,
  })
  expect(await body(download)).toEqual(f.bytes.subarray(2, 5))
  expect(await body(await f.request(f.coverPath))).toEqual(f.artwork)
  const head = await f.request(f.audioPath, 'HEAD', { range: 'bytes=2-4' })
  expect(head.status).toBe(200)
  expect(head.body).toBeUndefined()
  expect(head.headers['content-length']).toBe('10')
  for (const [range, start, end] of [
    ['bytes=2-4', 2, 4],
    ['bytes=-3', 7, 9],
    ['bytes=7-', 7, 9],
  ] as const) {
    const part = await f.request(f.audioPath, 'GET', { range })
    expect(part.status).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes ${start}-${end}/10`)
    expect(await body(part)).toEqual(f.bytes.subarray(start, end + 1))
  }
  expect(
    (await f.request(f.audioPath, 'GET', { range: 'bytes=10-' })).status,
  ).toBe(416)
  const ignored = await f.request(f.audioPath, 'GET', {
    range: 'bytes=2-4',
    'if-range': 'stale',
  })
  expect(ignored.status).toBe(200)
  expect(await body(ignored)).toEqual(f.bytes)
})

it('discovers newly added files and invalidates verified bytes after an edit', async () => {
  const f = await fixture()
  expect((await f.request()).headers.location).toBe(f.audio.url)
  await f.save()
  f.advance()
  expect(await body(await f.request())).toEqual(f.bytes)
  await fs.writeFile(
    resolve(f.root, '.local/incoming/New Mix.mp3'),
    'xxxxxxxxxx',
  )
  f.advance()
  expect((await f.request()).status).toBe(307)
  await f.save()
  expect(await body(await f.request())).toEqual(f.bytes)
})

it('uses committed feed artwork when an original is unavailable', async () => {
  const f = await fixture()
  const jpeg = Buffer.from('committed JPEG')
  const path = `/episode-artwork/v1-${f.cover.sha256}.jpg`
  await fs.mkdir(resolve(f.root, 'public/episode-artwork'), { recursive: true })
  await fs.mkdir(resolve(f.root, 'tools/content'), { recursive: true })
  await fs.writeFile(resolve(f.root, 'public' + path), jpeg)
  await fs.writeFile(
    resolve(f.root, 'tools/content/episode-artwork-manifest.json'),
    JSON.stringify({
      images: [
        {
          path,
          sourceSha256: f.cover.sha256,
          sha256: hash(jpeg),
          byteLength: jpeg.length,
        },
      ],
    }),
  )
  const response = await f.request(f.coverPath)
  expect(response.headers['content-type']).toBe('image/jpeg')
  expect(await body(response)).toEqual(jpeg)
})

it('never serves arbitrary, unpublished, linked, or incorrectly identified files', async () => {
  const f = await fixture()
  await fs.mkdir(resolve(f.root, '.git'))
  await fs.writeFile(resolve(f.root, '.git/New Mix.mp3'), f.bytes)
  await fs.symlink(
    resolve(f.root, '.git/New Mix.mp3'),
    resolve(f.root, '.local/incoming/New Mix.mp3'),
  )
  expect((await f.request()).status).toBe(307)
  expect((await f.request('/__dev/assets/audio/../../.env')).status).toBe(404)
  expect((await f.request('/__dev/assets/audio/unknown.mp3')).status).toBe(404)
  expect((await f.request(f.audioPath, 'POST')).status).toBe(405)
  await fs.unlink(resolve(f.root, '.local/incoming/New Mix.mp3'))
  await fs.writeFile(resolve(f.root, '.local/incoming/New Mix.mp3'), 'short')
  f.advance()
  expect((await f.request()).status).toBe(307)
  f.catalog.episodes[0]!.status = 'draft'
  expect((await f.request()).status).toBe(404)
})
