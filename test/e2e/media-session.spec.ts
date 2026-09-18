import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fulfillAudio, ready, stubArchiveMedia } from './media'

const long = await readFile(
  new URL('../fixtures/media-app/public/long.wav', import.meta.url),
)
const path = '/episodes/trey-turner-praxis'

test.beforeEach(async ({ page }) => {
  await stubArchiveMedia(page)
  await page.route('https://podcast.nurevolution.net/**', (route) =>
    fulfillAudio(route, long, 'audio/wav'),
  )
})

test('native Media Session follows the player and accepted episode identity', async ({
  page,
}) => {
  await page.goto(path)
  await ready(page)
  const supported = await page.evaluate(() =>
    Boolean(navigator.mediaSession && typeof MediaMetadata === 'function'),
  )
  test.skip(
    !supported,
    'This engine does not expose native Media Session metadata',
  )
  await expect
    .poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title))
    .toBe('Chariots')
  const audio = page.locator('audio')
  await audio.evaluate((element: HTMLAudioElement) => {
    element.muted = true
  })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => navigator.mediaSession.playbackState))
    .toBe('playing')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => navigator.mediaSession.playbackState))
    .toBe('paused')
  await page.locator('a[href="/episodes/trey-turner-ruminate"]').click()
  await ready(page)
  await expect
    .poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title))
    .toBe('Troglodyte')
  expect(
    await page.evaluate(() => ({
      artist: navigator.mediaSession.metadata?.artist,
      album: navigator.mediaSession.metadata?.album,
    })),
  ).toEqual({ artist: 'Mat Zo', album: 'Trey Turner - Ruminate' })
  await expect(audio).toHaveJSProperty('paused', true)
})

test('missing Media Session APIs leave ordinary playback and seeking usable', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(window, 'MediaMetadata', {
      configurable: true,
      value: undefined,
    })
  })
  await page.goto(path)
  await ready(page)
  const audio = page.locator('audio')
  await audio.evaluate((element: HTMLAudioElement) => {
    element.muted = true
  })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('.media-status')).toHaveText(/^Playing/)
  await page
    .getByRole('button', { name: 'Forward 30 seconds', exact: true })
    .click()
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThanOrEqual(30)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(audio).toHaveJSProperty('paused', true)
  expect(errors).toEqual([])
})
