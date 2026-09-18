import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import artwork from '../../tools/content/episode-artwork-manifest.json' with { type: 'json' }
import ruminate from '../../content/episodes/wp-484.json' with { type: 'json' }
import { parseRss } from '../../tools/content/feed/assert.ts'

export async function verifyFeedResources(
  origin: string,
  request: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const path = origin + '/chapters/trey-turner-ruminate.json'
  const response = await request(path)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(
    response.headers.get('content-type'),
    'application/json+chapters; charset=utf-8',
  )
  const body = await response.text()
  const { items } = parseRss(
    await (await request(origin + '/feed/podcast')).text(),
  )
  const item = items.find(
    (item) =>
      item.getElementsByTagName('guid')[0]!.textContent === ruminate.guid,
  )!
  const chapters = item.getElementsByTagNameNS(
    'https://podcastindex.org/namespace/1.0',
    'chapters',
  )[0]!
  const chapterUrl = new URL(chapters.getAttribute('url')!)
  assert.equal(chapterUrl.origin, 'https://nurevolution.net')
  assert.equal(chapterUrl.pathname, '/chapters/trey-turner-ruminate.json')
  assert.equal(
    chapterUrl.searchParams.get('v'),
    createHash('sha256').update(body).digest('hex'),
  )
  assert.equal(
    await (
      await request(origin + chapterUrl.pathname + chapterUrl.search)
    ).text(),
    body,
  )
  assert.deepEqual(JSON.parse(body), {
    version: '1.2.0',
    chapters: ruminate.tracks.map((track) => ({
      startTime: track.startTime,
      title: `${String(track.position).padStart(2, '0')}. ${track.artist} - ${track.title}`,
    })),
  })
  const etag = response.headers.get('etag')!
  assert.equal(
    (await request(path + '?v=old', { method: 'HEAD' })).headers.get('etag'),
    etag,
  )
  assert.equal(
    (await request(path, { headers: { 'If-None-Match': etag } })).status,
    304,
  )
  assert.equal((await request(origin + '/chapters/missing.json')).status, 404)
  for (const entry of artwork.images) {
    const head = await request(origin + entry.path, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-type'), 'image/jpeg')
    assert.equal(head.headers.get('content-length'), String(entry.byteLength))
    assert.equal(
      head.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    )
    assert.equal(head.headers.get('x-content-type-options'), 'nosniff')
  }
  const entry = artwork.images[0]!
  const image = await (await request(origin + entry.path)).arrayBuffer()
  assert.equal(
    createHash('sha256').update(Buffer.from(image)).digest('hex'),
    entry.sha256,
  )
}
