import { expect, test } from '@playwright/test'
import type { EpisodeSummary } from '../../shared/content/public'
import { previewBaseURL } from '../../playwright.config'
import { hydrated, stubArchiveMedia } from './media'

test('serves every thumbnail from the portable app with small WebP bodies on normal and preview origins', async ({
  request,
}) => {
  for (const origin of ['', previewBaseURL]) {
    const { episodes } = (await (
      await request.get(origin + '/api/episodes')
    ).json()) as { episodes: EpisodeSummary[] }
    let bytes = 0
    for (const episode of episodes) {
      expect(episode.artworkThumbnailUrl).toMatch(
        /^\/artwork-thumbnails\/v1-[a-f0-9]{64}\.webp$/,
      )
      const response = await request.get(origin + episode.artworkThumbnailUrl)
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('image/webp')
      const body = await response.body()
      expect(body.subarray(8, 12).toString()).toBe('WEBP')
      expect(body.length).toBeLessThanOrEqual(12 * 1024)
      bytes += body.length
    }
    expect(episodes).toHaveLength(55)
    expect(bytes).toBeLessThan(55 * 12 * 1024)
  }
})

test('scrolling the list requests thumbnails, and failed thumbnails never fall back to originals', async ({
  page,
}) => {
  await stubArchiveMedia(page)
  const originals = new Set<string>()
  page.on('request', (request) => {
    if (request.url().startsWith('https://nurevolution.net/wp/'))
      originals.add(request.url())
  })
  await page.route('**/artwork-thumbnails/**', (route) => route.abort('failed'))
  const detail = await (
    await page.request.get('/api/episodes/trey-turner-ruminate')
  ).json()
  await page.goto(detail.path)
  await hydrated(page)
  const thumbnails = page.locator('.episode-list-artwork')
  await expect(thumbnails).toHaveCount(55)
  for (let index = 0; index < 55; index += 5)
    await thumbnails.nth(index).scrollIntoViewIfNeeded()
  await thumbnails.last().scrollIntoViewIfNeeded()
  expect([...originals]).toEqual([detail.artworkUrl])
  await expect(
    page.locator('.episode-list a[aria-current="page"]'),
  ).toHaveAttribute('href', detail.path)
})
