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
        durationSeconds: 40,
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
test('track time display switches without seeking and resets to duration on reload', async ({
  page,
}) => {
  await fixture(page, [0, 8.25, 32])
  const toggle = page.locator('.track-time-toggle')
  const times = page.locator('.track-time')
  await expect(toggle).toHaveText('Show: Duration')
  await expect(toggle).toHaveAttribute('title', 'Click for Timestamp')
  await expect(times).toHaveText(['0:08', '0:23', '0:08'])
  await page.getByRole('button', { name: /^Seek to track 2:/ }).click()
  await at(page, 8.25)
  await toggle.focus()
  await toggle.press('Enter')
  await expect(toggle).toHaveText('Show: Timestamp')
  await expect(toggle).toHaveAttribute('title', 'Click for Duration')
  await expect(times).toHaveText(['0:00', '0:08', '0:32'])
  await at(page, 8.25)
  await expect(page.locator('audio')).toHaveJSProperty('paused', true)
  await expect(
    page.locator('.track-list li[aria-current] .track-number'),
  ).toHaveText('02')
  await toggle.press('Space')
  await expect(times).toHaveText(['0:08', '0:23', '0:08'])
  await page.getByRole('button', { name: /^Seek to track 3:/ }).click()
  await at(page, 32)
  await toggle.click()
  await page.reload()
  await ready(page)
  await expect(toggle).toHaveText('Show: Duration')
})

test('the current track plays and pauses in place with mouse and keyboard', async ({
  page,
}) => {
  await fixture(page, [0, 8.25, 32])
  const audio = page.locator('audio')
  await audio.evaluate((element: HTMLAudioElement) => {
    element.muted = true
    element.currentTime = 12.345
  })
  await at(page, 12.345)
  await expect(audio).toHaveJSProperty('seeking', false)
  const current = page.locator('.track-list li[aria-current] button.track-row')
  await expect(current).toHaveAccessibleName(/^Play track 2:/)
  let seeks = 0
  await page.exposeFunction('recordTrackSeek', () => {
    seeks++
  })
  await audio.evaluate((element: HTMLAudioElement) => {
    element.addEventListener('seeking', () => {
      void (
        window as typeof window & { recordTrackSeek: () => Promise<void> }
      ).recordTrackSeek()
    })
  })
  await current.click()
  await expect(page.locator('.media-status')).toHaveText(
    'Playing 2/3: Test tone - Track 2',
  )
  await expect(current).toHaveAccessibleName(/^Pause track 2:/)
  await expect(current.locator('.track-current')).toHaveCSS(
    'transition-duration',
    '1s',
  )
  await current.click()
  await expect(audio).toHaveJSProperty('paused', true)
  const pausedAt = await audio.evaluate((a: HTMLAudioElement) => a.currentTime)
  expect(pausedAt).toBeGreaterThanOrEqual(12.345)
  expect(pausedAt).toBeLessThan(32)
  await current.focus()
  await current.press('Enter')
  await expect(page.locator('.media-status')).toHaveText(
    'Playing 2/3: Test tone - Track 2',
  )
  await current.press('Space')
  await expect(audio).toHaveJSProperty('paused', true)
  expect(
    await audio.evaluate((a: HTMLAudioElement) => a.currentTime),
  ).toBeGreaterThanOrEqual(pausedAt)
  await expect(current).toBeFocused()
  expect(seeks).toBe(0)
})

test('the final track offers a seek at the episode end instead of replaying the whole episode', async ({
  page,
}) => {
  await fixture(page, [0, 8.25, 32])
  const audio = page.locator('audio')
  await audio.evaluate((element: HTMLAudioElement) => {
    element.muted = true
    element.currentTime = element.duration
  })
  await at(page, 40)
  await expect(audio).toHaveJSProperty('seeking', false)
  const final = page.locator('.track-list li[aria-current] button.track-row')
  await expect(final).toHaveAccessibleName(/^Seek to track 3:/)
  await final.click()
  await at(page, 32)
  await expect(audio).toHaveJSProperty('paused', true)
  await expect(final).toHaveAccessibleName(/^Play track 3:/)
  await final.click()
  await expect(page.locator('.media-status')).toHaveText(
    'Playing 3/3: Test tone - Track 3',
  )
  expect(
    await audio.evaluate((a: HTMLAudioElement) => a.currentTime),
  ).toBeGreaterThanOrEqual(32)
  await expect(page).toHaveURL(/trey-turner-praxis$/)
})

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
  await expect(page.locator('.media-status')).toHaveText(
    'Playing 2/3: Test tone - Track 2',
  )
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(8.25)
  await page.getByRole('button', { name: /^Seek to track 3:/ }).click()
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThanOrEqual(32)
  await expect(audio).toHaveJSProperty('paused', false)
  await expect(audio).toHaveJSProperty('seeking', false)
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(32.1)
  await expect(page.locator('.media-status')).toHaveText(
    'Playing 3/3: Test tone - Track 3',
  )
  await expect(page.getByRole('button', { name: 'Next track' })).toBeDisabled()
})

test('sample-based track starts select the clicked row after a fresh paused load', async ({
  page,
}) => {
  const starts = [0, 363826 / 44100, 1411201 / 44100]
  await fixture(page, starts)
  const audio = page.locator('audio')
  await at(page, 0)
  for (const position of [2, 3, 2]) {
    await page
      .getByRole('button', { name: new RegExp(`^Seek to track ${position}:`) })
      .click()
    await at(page, starts[position - 1]!)
    await expect(audio).toHaveJSProperty('seeking', false)
    await expect(audio).toHaveJSProperty('paused', true)
    const actual = await audio.evaluate((a: HTMLAudioElement) => a.currentTime)
    await expect(
      page.locator('.track-list li[aria-current] .track-number'),
      `Requested ${starts[position - 1]}, browser confirmed ${actual}`,
    ).toHaveText(String(position).padStart(2, '0'))
  }
  await page.getByRole('button', { name: 'Next track' }).click()
  await at(page, starts[2]!)
  await expect(page.getByRole('button', { name: 'Next track' })).toBeDisabled()
  await page.getByRole('button', { name: 'Previous track' }).click()
  await at(page, starts[1]!)
  await expect(
    page.locator('.track-list li[aria-current] .track-number'),
  ).toHaveText('02')
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
  await expect(page.locator('.track-list button.track-row')).toHaveCount(3)
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
