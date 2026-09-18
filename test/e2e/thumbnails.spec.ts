import { expect, test } from '@playwright/test'
import type { EpisodeSummary } from '../../shared/content/public'
import { devBaseURL } from '../../playwright.config'
import { hydrated, stubArchiveMedia } from './media'

test('serves every thumbnail from the portable app with small WebP bodies on normal and dev origins', async ({
  request,
}) => {
  for (const origin of ['', devBaseURL]) {
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
  const spacing = () =>
    page
      .locator('.episode-list li')
      .first()
      .evaluate((row) => {
        const image = row
          .querySelector('.episode-list-artwork')!
          .getBoundingClientRect()
        const text = row
          .querySelector('.episode-list-info')!
          .getBoundingClientRect()
        return text.left - image.right
      })
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const episodesTab = page.getByRole('tab', { name: 'Episodes', exact: true })
    if (width <= 700) await episodesTab.click()
    else await expect(episodesTab).toHaveCount(0)
    await expect.poll(spacing).toBe(12)
  }
  // iPadOS 14.3 ignores flex gaps; spacing must not depend on that property.
  await page.addStyleTag({
    content: '.episode-list li > a:first-child { gap: 0 !important }',
  })
  await expect.poll(spacing).toBe(12)
})

test('artist and date wrap as whole items and the separator disappears at a line start', async ({
  page,
}) => {
  await stubArchiveMedia(page)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/episodes/trey-turner-ruminate')
  await hydrated(page)
  await page.getByRole('tab', { name: 'Episodes', exact: true }).click()
  const metadata = page.locator('.episode-list-artist').first()
  const measure = () =>
    metadata.evaluate((element) => {
      const box = (selector: string) => {
        const bounds = element.querySelector(selector)!.getBoundingClientRect()
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          height: bounds.height,
        }
      }
      const bounds = element.getBoundingClientRect()
      return {
        artist: box('.episode-list-artist-name'),
        date: box('.episode-list-date'),
        separator: box('.episode-date-separator'),
        left: bounds.left,
        right: bounds.right,
        lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      }
    })
  for (const noGap of [false, true]) {
    await page.evaluate(
      (value) =>
        document.documentElement.classList.toggle('no-flex-gap', value),
      noGap,
    )
    await page.setViewportSize({ width: 460, height: 900 })
    const wide = await measure()
    expect(wide.date.top).toBeCloseTo(wide.artist.top, 1)
    expect(wide.separator.left).toBeGreaterThanOrEqual(wide.artist.right)
    await page.setViewportSize({ width: 350, height: 900 })
    const narrow = await measure()
    expect(narrow.date.top).toBeGreaterThanOrEqual(narrow.artist.bottom - 1)
    expect(narrow.date.left).toBeCloseTo(narrow.left, 1)
    expect(narrow.separator.right).toBeLessThanOrEqual(narrow.left + 0.1)
    await expect(metadata).toHaveCSS('overflow', 'hidden')
    expect(narrow.artist.height).toBeLessThanOrEqual(narrow.lineHeight + 1)
    expect(narrow.date.height).toBeLessThanOrEqual(narrow.lineHeight + 1)
  }
  await page.setViewportSize({ width: 320, height: 900 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  const enlarged = await measure()
  expect(enlarged.date.right).toBeLessThanOrEqual(enlarged.right + 1)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320)
})
