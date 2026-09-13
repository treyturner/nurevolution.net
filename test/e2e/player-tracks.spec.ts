import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fulfillAudio, ready, stubArchiveMedia } from './media'
const long = await readFile(
  new URL('../fixtures/media-app/public/long.wav', import.meta.url),
)
async function fixture(page: Page, starts: (number | null)[]) {
  await stubArchiveMedia(page)
  await page.route('https://podcast.nurevolution.net/**', (route) =>
    fulfillAudio(route, long, 'audio/wav'),
  )
  await page.route('**/api/episodes/trey-turner-praxis', async (route) => {
    const response = await route.fetch()
    const detail = await response.json()
    await route.fulfill({
      json: {
        ...detail,
        tracks: starts.map((startTime, i) => ({
          position: i + 1,
          artist: 'Test tone',
          title: `Track ${i + 1}`,
          startTime,
        })),
      },
    })
  })
  await page.goto('/')
  await ready(page)
  await page.locator('a[href="/episodes/trey-turner-praxis"]').click()
  await expect(page.locator('h1')).toHaveText('Praxis')
  await ready(page)
}
async function at(page: Page, seconds: number) {
  await expect
    .poll(() =>
      page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeCloseTo(seconds, 1)
}
test('timed rows seek paused or active with supported highlights and exact fractional targets', async ({
  page,
}) => {
  await fixture(page, [0, 8.25, 32])
  const audio = page.locator('audio')
  await page.getByRole('button', { name: /^Seek to track 2:/ }).click()
  await at(page, 8.25)
  await expect(audio).toHaveJSProperty('paused', true)
  await expect(page.locator('.track-list [aria-current]')).toContainText(
    'Track 2',
  )
  await page.getByRole('button', { name: 'Previous track' }).click()
  await at(page, 0)
  await page.getByRole('button', { name: 'Next track' }).click()
  await at(page, 8.25)
  await audio.evaluate((a: HTMLAudioElement) => {
    a.muted = true
  })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await page.getByRole('button', { name: /^Seek to track 3:/ }).click()
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThanOrEqual(32)
  await expect(audio).toHaveJSProperty('paused', false)
  await expect(page.getByRole('button', { name: 'Next track' })).toBeDisabled()
})
test('mobile keyboard track seeking preserves tabs and leaves uncertain gaps unhighlighted', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixture(page, [4, null, 8.25, 32, 40])
  await expect(
    page.getByRole('button', { name: 'Previous track' }),
  ).toBeDisabled()
  await page.getByRole('tab', { name: 'Tracklist' }).click()
  await expect(page.locator('.track-list li')).toHaveCount(5)
  await expect(page.locator('.track-list button')).toHaveCount(3)
  const first = page.getByRole('button', { name: /^Seek to track 1:/ })
  await first.focus()
  await first.press('Enter')
  await at(page, 4)
  await expect(first).toBeFocused()
  await expect(page.locator('.track-list [aria-current]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Next track' }).click()
  await at(page, 8.25)
  await expect(page.locator('.track-list [aria-current]')).toContainText(
    'Track 3',
  )
  await expect(page.getByRole('tab', { name: 'Tracklist' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('tab', { name: 'Episodes' }).click()
  await expect(page.locator('audio')).toHaveCount(1)
  await expect(page.locator('audio')).toHaveJSProperty('paused', true)
})
