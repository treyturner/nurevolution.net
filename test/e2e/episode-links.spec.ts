import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fulfillAudio, ready, stubArchiveMedia } from './media'

test.beforeEach(async ({ page }) => {
  await stubArchiveMedia(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copiedUrl = text
        },
      },
    })
  })
})

test('description links open a separate tab while the original episode keeps playing', async ({
  page,
  context,
}) => {
  const clip = await readFile(
    new URL('../fixtures/media-app/public/long.wav', import.meta.url),
  )
  await page.route('https://podcast.nurevolution.net/**', (route) =>
    fulfillAudio(route, clip, 'audio/wav'),
  )
  await context.route('https://open.spotify.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<p>Playlist destination</p>',
    }),
  )
  await page.goto('/episodes/trey-turner-the-dark-prophet')
  await ready(page)
  const originalUrl = page.url()
  const audio = page.locator('audio')
  const element = (await audio.elementHandle())!
  await audio.evaluate((a: HTMLAudioElement) => {
    a.muted = true
  })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('.media-status')).toHaveText('Playing')
  const before = await audio.evaluate((a: HTMLAudioElement) => a.currentTime)
  const playlist = page
    .locator('.description')
    .getByRole('link', { name: 'Spotify playlist' })
  const destination = await playlist.getAttribute('href')
  const opened = page.waitForEvent('popup')
  await playlist.click()
  const popup = await opened
  try {
    await expect(popup).toHaveURL(destination!)
    expect(await popup.evaluate(() => window.opener === null)).toBe(true)
    await expect(page).toHaveURL(originalUrl)
    expect(await element.evaluate((a) => a.isConnected)).toBe(true)
    await expect(audio).toHaveJSProperty('paused', false)
    await expect
      .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
      .toBeGreaterThan(before)
  } finally {
    await popup.close()
  }
})

test('keyboard copying preserves the selected player and shows temporary feedback beside the button', async ({
  page,
}) => {
  await page.goto('/episodes/fracture-broken')
  await ready(page)
  const path = page.url()
  const audio = await page.locator('audio').getAttribute('src')
  const row = page.locator('.episode-list li').first()
  const episodePath = await row.locator('a').first().getAttribute('href')
  const button = row.getByRole('button', { name: /^Copy link to/ })
  await button.focus()
  await page.keyboard.press('Enter')
  const toast = page.locator('.copy-link-toast')
  await expect(toast).toHaveText('Episode link copied')
  await expect(page.locator('html')).toHaveAttribute(
    'data-copied-url',
    `https://nurevolution.net${episodePath}`,
  )
  await expect(button).toBeFocused()
  expect(page.url()).toBe(path)
  await expect(page.locator('audio')).toHaveAttribute('src', audio!)
  const buttonBox = (await button.boundingBox())!
  const toastBox = (await toast.boundingBox())!
  expect(Math.abs(toastBox.y + toastBox.height + 8 - buttonBox.y)).toBeLessThan(
    1,
  )
  const linkIcon = (await button.locator('svg').boundingBox())!
  const downloadIcon = (await row.locator('.row-download svg').boundingBox())!
  expect(linkIcon.height).toBeLessThanOrEqual(downloadIcon.height)
  expect(
    Math.abs(
      linkIcon.y +
        linkIcon.height / 2 -
        downloadIcon.y -
        downloadIcon.height / 2,
    ),
  ).toBeLessThan(1)
  await expect(toast).toBeHidden({ timeout: 6000 })
})

test('the compact RSS button copies the feed URL without interrupting playback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 })
  const clip = await readFile(
    new URL('../fixtures/media-app/public/long.wav', import.meta.url),
  )
  await page.route('https://podcast.nurevolution.net/**', (route) =>
    fulfillAudio(route, clip, 'audio/wav'),
  )
  await page.goto('/episodes/trey-turner-ruminate')
  await ready(page)
  const originalUrl = page.url()
  const audio = page.locator('audio')
  const element = (await audio.elementHandle())!
  await audio.evaluate((a: HTMLAudioElement) => {
    a.muted = true
  })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('.media-status')).toHaveText('Playing')
  const before = await audio.evaluate((a: HTMLAudioElement) => a.currentTime)
  const button = page.getByRole('button', { name: 'Copy RSS URL' })
  await expect(button.locator('.rss-label')).toBeHidden()
  await expect(button.locator('.rss-icon')).toBeVisible()
  await button.focus()
  await page.keyboard.press('Enter')
  const toast = page.locator('.copy-link-toast')
  await expect(toast).toHaveText('RSS URL copied')
  await expect(page.locator('html')).toHaveAttribute(
    'data-copied-url',
    'https://nurevolution.net/feed/podcast',
  )
  const box = (await toast.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(12)
  expect(box.x + box.width).toBeLessThanOrEqual(308)
  await expect(button).toBeFocused()
  await expect(page).toHaveURL(originalUrl)
  expect(await element.evaluate((a) => a.isConnected)).toBe(true)
  await expect(audio).toHaveJSProperty('paused', false)
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(before)
  await expect(toast).toBeHidden({ timeout: 6000 })
})

test('keeps feedback inside a narrow viewport and falls back to top center after its button scrolls away', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/episodes/fracture-broken')
  await ready(page)
  const button = page.locator('.row-copy-link').first()
  await button.click()
  const toast = page.locator('.copy-link-toast')
  await expect(toast).toBeVisible()
  let box = (await toast.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(12)
  expect(box.x + box.width).toBeLessThanOrEqual(308)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(toast).toHaveCSS('top', '12px')
  box = (await toast.boundingBox())!
  expect(Math.abs(box.x + box.width / 2 - 160)).toBeLessThan(1)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
