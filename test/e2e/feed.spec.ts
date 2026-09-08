import { expect, test } from '@playwright/test'
import { readCatalog } from '../../server/content/repository.ts'
import { publicFeedArchive } from '../../server/content/feed.ts'
import { fileReader } from '../../tools/content/files.ts'
import { assertPodcastFeed } from '../../tools/content/feed/assert.ts'

const { catalog } = await readCatalog(fileReader('content'))
const archive = publicFeedArchive(catalog, Date.now())
const freshness = 'public, max-age=60, must-revalidate'

test('serves the entire feed with canonical URLs and matching GET/HEAD headers', async ({
  request,
}) => {
  const response = await request.get('/feed/podcast')
  expect(response.status()).toBe(200)
  const headers = response.headers(),
    xml = await response.text()
  expect(headers['content-type']).toBe('application/rss+xml; charset=utf-8')
  expect(headers['cache-control']).toBe(freshness)
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers.etag).toMatch(/^W\/"[a-f0-9]{64}"$/)
  expect(headers).not.toHaveProperty('set-cookie')
  expect(headers).not.toHaveProperty('last-modified')
  expect(assertPodcastFeed(xml, archive)).toMatchObject({
    items: 55,
    newestId: 'wp-484',
    oldestId: 'wp-337',
  })
  expect(xml).not.toMatch(
    /sourceRoot|sha256|sourceSnapshot|<html|\/home\/coder/,
  )
  const head = await request.head('/feed/podcast')
  expect(head.status()).toBe(200)
  expect((await head.body()).length).toBe(0)
  for (const name of [
    'content-type',
    'cache-control',
    'x-content-type-options',
    'etag',
  ])
    expect(head.headers()[name]).toBe(headers[name])
  const tracked = await request.get('/feed/podcast?tracking=example', {
    headers: { host: 'untrusted.example' },
  })
  expect(await tracked.text()).toBe(xml)
  expect(tracked.headers().etag).toBe(headers.etag)
})

test('supports conditional GET and HEAD without timestamp-derived freshness', async ({
  request,
}) => {
  const response = await request.get('/feed/podcast'),
    etag = response.headers().etag!
  for (const method of ['GET', 'HEAD']) {
    for (const validator of [
      etag,
      etag.slice(2),
      '*',
      `"old,comma", ${etag}`,
    ]) {
      const result = await request.fetch('/feed/podcast', {
        method,
        headers: {
          'if-none-match': validator,
          'if-modified-since': 'Tue, 08 Sep 2099 00:00:00 GMT',
        },
      })
      expect(result.status()).toBe(304)
      expect(result.headers().etag).toBe(etag)
      expect(result.headers()['cache-control']).toBe(freshness)
      expect((await result.body()).length).toBe(0)
    }
  }
  const nonMatching: Record<string, string>[] = [
    { 'if-none-match': '"old"' },
    { 'if-none-match': `${etag}, invalid` },
    { 'if-modified-since': 'Tue, 08 Sep 2099 00:00:00 GMT' },
  ]
  for (const headers of nonMatching) {
    const result = await request.get('/feed/podcast', { headers })
    expect(result.status()).toBe(200)
    expect(await result.text()).toBe(await response.text())
  }
})

test('redirects only verified feed aliases and rejects unsupported methods', async ({
  request,
}) => {
  const canonical = await request.get('/feed/podcast')
  for (const path of [
    '/feed/podcast/',
    '/?feed=podcast',
    '/?feed=podcast&tracking=1',
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const redirect = await request.fetch(path, { method, maxRedirects: 0 })
      expect(redirect.status(), path).toBe(301)
      expect(redirect.headers().location).toBe('/feed/podcast')
      expect(redirect.headers()['cache-control']).toBe(freshness)
      if (method === 'HEAD') expect((await redirect.body()).length).toBe(0)
    }
    const followed = await request.get(path)
    expect(followed.status()).toBe(200)
    expect(await followed.text()).toBe(await canonical.text())
  }
  for (const path of ['/feed/podcast', '/feed/podcast/', '/?feed=podcast']) {
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const result = await request.fetch(path, { method, maxRedirects: 0 })
      expect(result.status(), `${method} ${path}`).toBe(405)
      expect(result.headers().allow).toBe('GET, HEAD')
      expect(result.headers()['cache-control']).toBe('no-store')
      expect(result.headers()['content-type']).toBe('text/plain; charset=utf-8')
      expect(result.headers()).not.toHaveProperty('location')
    }
  }
  for (const path of [
    '/',
    '/?feed=other',
    '/?feed=Podcast',
    '/?feed=podcast&feed=podcast',
  ]) {
    const result = await request.get(path, { maxRedirects: 0 })
    expect(result.status()).toBe(200)
    expect(result.headers()['content-type']).toContain('text/html')
  }
  for (const path of [
    '/wp/?feed=podcast',
    '/wp/feed/podcast',
    '/feed/unknown',
    '/podcast/unknown?feed=podcast',
  ])
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(
      404,
    )
  expect((await request.get('/api/show')).headers()['content-type']).toContain(
    'application/json',
  )
})
