import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  previewBaseURL,
  previewWebOrigin,
  previewMediaOrigin,
} from '../../playwright.config'
import { ready, stubArchiveMedia } from './media'

test('preview renders and navigates with production media blocked and retains canonical RSS identity', async ({
  page,
  request,
  browserName,
}) => {
  const legacyRequests: string[] = []
  await page.route(/^https:\/\/(podcast\.)?nurevolution\.net\//, (route) => {
    legacyRequests.push(route.request().url())
    return route.abort('blockedbyclient')
  })
  await stubArchiveMedia(page, {
    web: previewWebOrigin,
    media: previewMediaOrigin,
  })
  const selected = '/episodes/trey-turner-praxis'
  const detail = await (
    await request.get(previewBaseURL + '/api' + selected)
  ).json()
  const artwork = previewWebOrigin + new URL(detail.artworkUrl).pathname
  const audio = previewMediaOrigin + new URL(detail.audio.url).pathname
  const html = await (await request.get(previewBaseURL + selected)).text()
  expect(html).toContain(`src="${artwork}"`)
  await page.goto(previewBaseURL + '/')
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
  const feed = await (
    await request.get(previewBaseURL + '/feed/podcast')
  ).text()
  expect(feed).toContain(detail.audio.url.replaceAll('&', '&amp;'))
  expect(feed).not.toContain(previewWebOrigin)
  expect(feed).not.toContain(previewMediaOrigin)
  await expect(
    page.locator('link[rel="alternate"][type="application/rss+xml"]'),
  ).toHaveAttribute('href', '/feed/podcast')
  const rssLink = page.getByRole('link', { name: 'Subscribe via RSS' })
  await expect(rssLink).toHaveAttribute('href', '/feed/podcast')
  const feedUrl = previewBaseURL + '/feed/podcast'
  const [openedFeed, download] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === feedUrl && response.request().isNavigationRequest(),
    ),
    // Firefox saves RSS; Chromium/WebKit render the XML document.
    browserName === 'firefox'
      ? page.waitForEvent('download')
      : page.waitForURL(feedUrl),
    rssLink.click(),
  ])
  expect(openedFeed.status()).toBe(200)
  if (download) {
    expect(download.url()).toBe(feedUrl)
    expect(await download.failure()).toBeNull()
    expect(await readFile((await download.path())!, 'utf8')).toBe(feed)
  } else expect(await openedFeed.text()).toBe(feed)
  expect(legacyRequests).toEqual([])
})
