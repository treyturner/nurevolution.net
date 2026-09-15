import { expect, test } from '@playwright/test'
import {
  devBaseURL,
  devWebOrigin,
  devMediaOrigin,
} from '../../playwright.config'
import { ready, stubArchiveMedia } from './media'

test('dev renders and navigates with production media blocked and retains canonical RSS identity', async ({
  page,
  request,
}) => {
  const legacyRequests: string[] = []
  await page.route(/^https:\/\/(podcast\.)?nurevolution\.net\//, (route) => {
    legacyRequests.push(route.request().url())
    return route.abort('blockedbyclient')
  })
  await stubArchiveMedia(page, {
    web: devWebOrigin,
    media: devMediaOrigin,
  })
  const selected = '/episodes/trey-turner-praxis'
  const detail = await (
    await request.get(devBaseURL + '/api' + selected)
  ).json()
  const artwork = devWebOrigin + new URL(detail.artworkUrl).pathname
  const audio = devMediaOrigin + new URL(detail.audio.url).pathname
  const html = await (await request.get(devBaseURL + selected)).text()
  expect(html).toContain(`src="${artwork}"`)
  await page.goto(devBaseURL + '/')
  await ready(page)
  await expect(page.locator('.artwork img')).toBeVisible()
  await page.locator(`a[href="${selected}"]`).click()
  await ready(page)
  await expect(page.locator('.artwork img')).toHaveAttribute('src', artwork)
  await expect
    .poll(() =>
      page
        .locator('.artwork img')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0)
  await expect(page.locator('audio')).toHaveAttribute('src', audio)
  await page.reload()
  await ready(page)
  await expect(page.locator('audio')).toHaveAttribute('src', audio)
  expect(legacyRequests).toEqual([])
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://nurevolution.net' + selected,
  )
  const feed = await (await request.get(devBaseURL + '/feed/podcast')).text()
  expect(feed).toContain(detail.audio.url.replaceAll('&', '&amp;'))
  expect(feed).not.toContain(devWebOrigin)
  expect(feed).not.toContain(devMediaOrigin)
  await expect(
    page.locator('link[rel="alternate"][type="application/rss+xml"]'),
  ).toHaveAttribute('href', '/feed/podcast')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copiedUrl = text
        },
      },
    })
  })
  await page
    .getByRole('link', { name: 'Subscribe via RSS (copy RSS URL)' })
    .click()
  await expect(page.locator('.copy-link-toast')).toHaveText('RSS URL copied')
  await expect(page.locator('html')).toHaveAttribute(
    'data-copied-url',
    'https://nurevolution.net/feed/podcast',
  )
  await expect(page).toHaveURL(devBaseURL + selected)
  expect(legacyRequests).toEqual([])
})
