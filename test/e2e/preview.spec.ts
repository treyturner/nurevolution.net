import { expect, test } from '@playwright/test'
import {
  previewBaseURL,
  previewWebOrigin,
  previewMediaOrigin,
} from '../../playwright.config'
import { ready, stubArchiveMedia } from './media'

test('preview renders and navigates with production media blocked and retains canonical RSS identity', async ({
  page,
  request,
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
})
