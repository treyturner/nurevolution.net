import { expect, test } from '@playwright/test'
import { hydrated, stubArchiveMedia } from './media'

test('shows compact accessible episode and track badges without marking other tracks explicit', async ({
  page,
}) => {
  await stubArchiveMedia(page)
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.goto('/episodes/trey-turner-ruminate')
  await hydrated(page)
  // The synthetic audio is only a few seconds long; expose the real episode
  // duration so later track controls remain available for this UI check.
  await page.locator('audio').evaluate((audio) => {
    Object.defineProperty(audio, 'duration', {
      configurable: true,
      value: 3610,
    })
    audio.dispatchEvent(new Event('durationchange'))
  })
  await expect(page.locator('.episode-list .explicit-badge')).toHaveCount(7)
  await expect(
    page
      .locator('.episode-meta')
      .getByRole('img', { name: 'Explicit content' }),
  ).toBeVisible()
  const tracks = page.locator('.track-list')
  await expect(
    tracks.getByRole('img', { name: 'Explicit content' }),
  ).toHaveCount(2)
  await expect(
    tracks
      .locator('li')
      .filter({ hasText: "The Fuckin' Real" })
      .getByRole('img', { name: 'Explicit content' }),
  ).toBeVisible()
  await expect(
    tracks
      .locator('li')
      .filter({ hasText: 'Troglodyte' })
      .locator('.explicit-badge'),
  ).toHaveCount(0)
  await expect(
    tracks.getByRole('button', {
      name: /Seek to track 15: .*Explicit content/,
    }),
  ).toBeVisible()
  const badge = page.locator('.episode-meta .explicit-badge')
  const bounds = (await badge.boundingBox())!
  expect(bounds.width).toBe(14)
  expect(bounds.height).toBe(14)
  await expect(badge).toHaveAttribute('title', 'Explicit content')
  await page
    .locator('.episode-list a[href="/episodes/trey-turner-praxis"]')
    .click()
  await expect(page.locator('h1')).toHaveText('Praxis')
  await expect(page.locator('.episode-meta .explicit-badge')).toHaveCount(0)
  await expect(page.locator('.track-list .explicit-badge')).toHaveCount(0)
})

test('keeps explicit track badges readable on narrow screens with enlarged text', async ({
  page,
}) => {
  await stubArchiveMedia(page)
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/episodes/trey-turner-ruminate')
  await hydrated(page)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await page.getByRole('tab', { name: 'Tracklist' }).click()
  const badge = page
    .locator('.track-list li')
    .filter({ hasText: "The Fuckin' Real" })
    .getByRole('img', { name: 'Explicit content' })
  await badge.scrollIntoViewIfNeeded()
  await expect(badge).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  const bounds = (await badge.boundingBox())!
  expect(bounds.width).toBe(28)
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320)
})
