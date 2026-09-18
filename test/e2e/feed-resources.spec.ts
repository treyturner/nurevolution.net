import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import manifest from '../../tools/content/episode-artwork-manifest.json' with { type: 'json' }
import { readCatalog } from '../../server/content/repository.ts'
import { fileReader } from '../../tools/content/files.ts'
import { selectPublic, episodeDetail } from '../../shared/content/public.ts'
import { serializeChapters } from '../../shared/content/chapters.ts'
import { parseRss } from '../../tools/content/feed/assert.ts'
import { devBaseURL } from '../../playwright.config'

const { catalog } = await readCatalog(fileReader('content'))

test('advertises canonical artwork for all episodes and resolvable chapters only for known starts', async ({
  request,
}) => {
  const { items } = parseRss(await (await request.get('/feed/podcast')).text())
  let chapterCount = 0
  let trackCount = 0
  for (const item of items) {
    const episode = catalog.episodes.find(
      (entry) =>
        entry.guid === item.getElementsByTagName('guid')[0]!.textContent,
    )!
    const artwork = item.getElementsByTagNameNS(
      'http://www.itunes.com/dtds/podcast-1.0.dtd',
      'image',
    )
    expect(artwork.length).toBe(1)
    const artworkUrl = new URL(artwork[0]!.getAttribute('href')!)
    expect(artworkUrl.origin).toBe(catalog.show.siteUrl)
    const asset = catalog.assets.find(
      (entry) => entry.id === episode.artworkAssetId,
    )!
    expect(artworkUrl.pathname).toBe(`/episode-artwork/v1-${asset.sha256}.jpg`)
    expect((await request.head(artworkUrl.pathname)).status()).toBe(200)
    const references = item.getElementsByTagNameNS(
      'https://podcastindex.org/namespace/1.0',
      'chapters',
    )
    const known = episode.tracks.filter((track) => track.startTime !== null)
    expect(references.length).toBe(known.length ? 1 : 0)
    if (!known.length) continue
    const reference = references[0]!
    expect(reference.getAttribute('type')).toBe('application/json+chapters')
    const url = new URL(reference.getAttribute('url')!)
    expect(url.origin).toBe(catalog.show.siteUrl)
    expect(url.pathname).toBe(`/chapters/${episode.slug}.json`)
    const response = await request.get(url.pathname + url.search)
    expect(response.status()).toBe(200)
    const body = await response.body()
    expect(url.searchParams.get('v')).toBe(
      createHash('sha256').update(body).digest('hex'),
    )
    expect((await response.json()).chapters).toEqual(
      known.map((track) => ({
        startTime: track.startTime,
        title: `${String(track.position).padStart(2, '0')}. ${track.artist} - ${track.title}`,
      })),
    )
    chapterCount++
    trackCount += known.length
  }
  expect(items.length).toBe(55)
  expect(chapterCount).toBe(34)
  expect(trackCount).toBe(626)
})

test('serves exact current chapters for every timed episode and no document for untimed episodes', async ({
  request,
}) => {
  let timed = 0
  for (const episode of selectPublic(catalog, Date.now())) {
    const path = `/chapters/${episode.slug}.json`
    const expected = serializeChapters(episodeDetail(catalog, episode).tracks)
    const response = await request.get(path)
    expect(response.status(), episode.slug).toBe(expected === null ? 404 : 200)
    if (expected === null) {
      expect(response.headers()['cache-control']).toBe('no-store')
      continue
    }
    timed++
    expect(await response.text()).toBe(expected)
    expect(response.headers()).toMatchObject({
      'content-type': 'application/json+chapters; charset=utf-8',
      'cache-control': 'public, max-age=60, must-revalidate',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'ETag',
    })
  }
  expect(timed).toBe(34)
})

test('chapter hints serve current data with GET/HEAD/304, including development origins', async ({
  request,
}) => {
  const path = '/chapters/trey-turner-ruminate.json'
  const response = await request.get(path),
    body = await response.text(),
    etag = response.headers().etag!
  expect(etag).toBe(`W/"${createHash('sha256').update(body).digest('hex')}"`)
  for (const origin of ['', devBaseURL])
    for (const query of ['', '?v=older-version', '?v=' + etag.slice(3, -1)]) {
      const url = origin + path + query
      const get = await request.get(url)
      expect(await get.text()).toBe(body)
      expect(get.headers().etag).toBe(etag)
      const head = await request.head(url)
      expect(head.status()).toBe(200)
      expect(await head.body()).toHaveLength(0)
      expect(head.headers().etag).toBe(etag)
      for (const method of ['GET', 'HEAD']) {
        const match = await request.fetch(url, {
          method,
          headers: { 'If-None-Match': etag },
        })
        expect(match.status()).toBe(304)
        expect(await match.body()).toHaveLength(0)
      }
    }
  const bad = await request.post(path)
  expect(bad.status()).toBe(405)
  expect(bad.headers().allow).toBe('GET, HEAD')
  const missing = await request.get('/chapters/nonexistent.json', {
    headers: { 'If-None-Match': '*' },
  })
  expect(missing.status()).toBe(404)
  expect(missing.headers()['cache-control']).toBe('no-store')
})

test('ships all verified episode artwork with immutable exact-path headers and HEAD support', async ({
  request,
}) => {
  for (const entry of manifest.images) {
    const response = await request.get(entry.path)
    expect(response.status(), entry.path).toBe(200)
    expect(response.headers()).toMatchObject({
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    })
    const body = await response.body()
    expect(body.length).toBe(entry.byteLength)
    expect(createHash('sha256').update(body).digest('hex')).toBe(entry.sha256)
  }
  const head = await request.head(devBaseURL + manifest.images[0]!.path)
  expect(head.status()).toBe(200)
  expect(await head.body()).toHaveLength(0)
  expect(head.headers()['content-type']).toBe('image/jpeg')
  expect(head.headers()['cache-control']).toBe(
    'public, max-age=31536000, immutable',
  )
  const unknown = await request.get('/episode-artwork/unknown.jpg')
  expect(unknown.status()).toBe(404)
  expect(unknown.headers()['cache-control'] ?? '').not.toContain('immutable')
})
