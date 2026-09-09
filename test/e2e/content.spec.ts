import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  assetsSchema,
  episodeSchema,
  showSchema,
} from '../../shared/content/schema.ts'
import inventory from '../../docs/migration/inventory.json' with { type: 'json' }
import timings from '../../docs/migration/track-timings.json' with { type: 'json' }
import { readCatalog } from '../../server/content/repository.ts'
import { publicFeedArchive } from '../../server/content/feed.ts'
import { fileReader } from '../../tools/content/files.ts'
import { assertPodcastFeed } from '../../tools/content/feed/assert.ts'

const episodeFiles = (await readdir('content/episodes')).sort()
const canonical = await Promise.all(
  episodeFiles.map(async (path) =>
    episodeSchema.parse(
      JSON.parse(await readFile(`content/episodes/${path}`, 'utf8')),
    ),
  ),
)
const assets = assetsSchema.parse(
  JSON.parse(await readFile('content/assets.json', 'utf8')),
).assets
const show = showSchema.parse(
  JSON.parse(await readFile('content/show.json', 'utf8')),
)

test('serves the complete canonical archive with subscriber identities, precise tracks and safe projections', async ({
  request,
}) => {
  const response = await request.get('/api/episodes')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('application/json')
  const { episodes } = await response.json()
  const ordered = [...canonical].sort(
    (a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!),
  )
  expect(episodes.map((e: { id: string }) => e.id)).toEqual(
    ordered.map((e) => e.id),
  )
  expect(episodes).toHaveLength(55)
  let tracks = 0,
    starts = 0
  for (const expected of ordered) {
    const summary = episodes.find((e: { id: string }) => e.id === expected.id)
    expect(Object.keys(summary).sort()).toEqual(
      [
        'id',
        'slug',
        'path',
        'title',
        'artist',
        'publishedAt',
        'durationSeconds',
        'artworkUrl',
      ].sort(),
    )
    const detailResponse = await request.get(`/api/episodes/${expected.slug}`)
    expect(detailResponse.status()).toBe(200)
    const detail = await detailResponse.json()
    const audio = assets.find((a) => a.id === expected.audioAssetId)!
    expect(detail).toEqual({
      id: expected.id,
      slug: expected.slug,
      path: `/episodes/${expected.slug}`,
      title: expected.title,
      artist: expected.artist,
      publishedAt: expected.publishedAt,
      durationSeconds: expected.durationSeconds,
      artworkUrl: assets.find((a) => a.id === expected.artworkAssetId)!.url,
      descriptionHtml: expected.descriptionHtml,
      guid: expected.guid,
      guidIsPermalink: expected.guidIsPermalink,
      audio: {
        url: audio.url,
        mediaType: audio.mediaType,
        byteLength: audio.byteLength,
        downloadFilename: audio.relativePath.split('/').at(-1),
      },
      tracks: expected.tracks,
    })
    const raw = inventory.episodes.find((e) => e.id === expected.id)!
    expect(detail.guid).toBe(raw.originalIdentity.feedGuid)
    expect(detail.guidIsPermalink).toBe(
      raw.originalIdentity.feedGuidIsPermalink,
    )
    expect(detail.audio).toMatchObject({
      url: raw.enclosure.url,
      mediaType: raw.enclosure.type,
      byteLength: raw.enclosure.byteLength,
    })
    expect(Date.parse(detail.publishedAt)).toBe(
      Date.parse(raw.publication.feedRfc822),
    )
    for (const [index, source] of raw.tracklist.tracks.entries()) {
      expect(detail.tracks[index]).toEqual({
        ...source,
        title:
          raw.id === 'wp-281' && source.position === 4
            ? source.title.replace('\u0092', '’')
            : source.title,
        startTime:
          raw.id === 'wp-417'
            ? timings.episodes.find((e) => e.episodeId === 'wp-417')!.tracks[
                index
              ]!.startTime
            : source.startTime,
      })
    }
    tracks += detail.tracks.length
    starts += detail.tracks.filter(
      (t: { startTime: number | null }) => t.startTime !== null,
    ).length
    expect(JSON.stringify(detail)).not.toMatch(
      /sourceRoot|relativePath|sourceSnapshot|databaseGuid|sha256/,
    )
  }
  expect({ tracks, starts }).toEqual({ tracks: 832, starts: 338 })
  const showResponse = await request.get('/api/show')
  expect(showResponse.status()).toBe(200)
  expect(await showResponse.json()).toEqual({
    id: show.id,
    title: show.title,
    descriptionText: show.descriptionText,
    siteUrl: show.siteUrl,
    feedUrl: show.feedUrl,
    standardArtworkUrl: assets.find(
      (a) => a.id === show.standardArtworkAssetId,
    )!.url,
    itunesArtworkUrl: assets.find((a) => a.id === show.itunesArtworkAssetId)!
      .url,
  })
})

test('returns real 404s for unknown episodes and keeps canonical sources out of public routes', async ({
  request,
}) => {
  for (const path of [
    '/api/episodes/unknown',
    '/api/episodes/wp-417',
    '/api/episodes/show.json',
    '/content/show.json',
    '/content/wordpress-import.json',
    '/content/episodes/wp-417.json',
  ]) {
    expect((await request.get(path)).status(), path).toBe(404)
  }
})

test('loads server assets from a portable production output without a checkout', async ({
  playwright,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The same Node output needs one portability check',
  )
  const root = await mkdtemp(resolve(tmpdir(), 'nurevolution-output-'))
  await cp('.output', resolve(root, '.output'), { recursive: true })
  // Nitro treats PORT=0 as its default (3000), rather than asking the OS for a port.
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  if (!address || typeof address === 'string')
    throw new Error('Expected a TCP port')
  const port = String(address.port)
  await new Promise<void>((done, reject) =>
    reservation.close((error) => (error ? reject(error) : done())),
  )
  const child = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      NITRO_HOST: '127.0.0.1',
      PORT: port,
      NITRO_PORT: port,
      NITRO_UNIX_SOCKET: undefined,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const baseURL = await new Promise<string>((resolveUrl, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Portable server did not listen')),
        15_000,
      )
      let output = '',
        errors = ''
      child.stderr.on('data', (chunk: Buffer) => {
        errors += chunk.toString()
      })
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/)
        if (match) {
          clearTimeout(timer)
          resolveUrl(match[0])
        }
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(
          new Error(`Portable server exited: ${code}\n${output}\n${errors}`),
        )
      })
    })
    const request = await playwright.request.newContext({ baseURL })
    try {
      expect(
        (await (await request.get('/api/episodes')).json()).episodes,
      ).toHaveLength(55)
      const detail = await request.get('/api/episodes/trey-turner-praxis')
      expect(detail.status()).toBe(200)
      expect((await detail.json()).tracks).toHaveLength(21)
      const feed = await request.get('/feed/podcast')
      expect(feed.status()).toBe(200)
      const { catalog } = await readCatalog(fileReader('content'))
      expect(
        assertPodcastFeed(
          await feed.text(),
          publicFeedArchive(catalog, Date.now()),
        ).items,
      ).toBe(55)
      expect(await readdir(root)).toEqual(['.output'])
      const publicFiles = await readdir(resolve(root, '.output/public'), {
        recursive: true,
      })
      expect(
        publicFiles.some(
          (file) => file.includes('content') || file.includes('wp-417'),
        ),
      ).toBe(false)
      for (const file of publicFiles.filter((file) => file.endsWith('.js'))) {
        expect(
          await readFile(resolve(root, '.output/public', file), 'utf8'),
        ).not.toMatch(/sourceSnapshotId|M0-TRACK-TIMING|sourceRoot/)
      }
    } finally {
      await request.dispose()
    }
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }
    await rm(root, { recursive: true, force: true })
  }
})
