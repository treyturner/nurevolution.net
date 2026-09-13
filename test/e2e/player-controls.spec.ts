import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fulfillAudio, ready, stubArchiveMedia } from './media'
const long = await readFile(
  new URL('../fixtures/media-app/public/long.wav', import.meta.url),
)
test.beforeEach(async ({ page }) => {
  await stubArchiveMedia(page)
  await page.route('https://podcast.nurevolution.net/**', (route) =>
    fulfillAudio(route, long, 'audio/wav'),
  )
})
test('custom controls seek and skip while paused and active through the same real audio element', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  const audio = page.locator('audio')
  await expect(audio).toHaveJSProperty('controls', false)
  await expect(
    page.getByRole('slider', { name: 'Playback position' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Forward 30 seconds' }).click()
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeCloseTo(30, 1)
  await expect(audio).toHaveJSProperty('paused', true)
  await page.getByRole('button', { name: 'Back 30 seconds' }).click()
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBe(0)
  await audio.evaluate((a: HTMLAudioElement) => {
    a.muted = true
  })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await page.getByRole('button', { name: 'Forward 30 seconds' }).click()
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThanOrEqual(30)
  await expect(audio).toHaveJSProperty('paused', false)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(audio).toHaveJSProperty('paused', true)
})
test('seek slider keyboard steps, endpoints, and scrub commits preserve pause and accessible values', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  const slider = page.getByRole('slider', { name: 'Playback position' })
  const audio = page.locator('audio')
  await slider.focus()
  await slider.press('ArrowRight')
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeCloseTo(5, 1)
  await slider.press('PageUp')
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeCloseTo(35, 1)
  await slider.press('End')
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeCloseTo(40, 1)
  await expect(audio).toHaveJSProperty('paused', true)
  await slider.press('Home')
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBe(0)
  await expect(slider).toHaveAttribute(
    'aria-valuetext',
    '0 seconds of 40 seconds',
  )
  const box = (await slider.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(audio).toHaveJSProperty('currentTime', 0)
  await page.mouse.up()
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(15)
  await expect(audio).toHaveJSProperty('paused', true)
})
test('volume keyboard and mute reflect native state; unsupported volume has an honest fallback', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  const audio = page.locator('audio')
  const volume = page.getByRole('slider', { name: 'Volume' })
  await volume.focus()
  await volume.press('ArrowLeft')
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.volume))
    .toBeCloseTo(0.95, 3)
  await page.getByRole('button', { name: 'Mute', exact: true }).click()
  await expect(audio).toHaveJSProperty('muted', true)
  await page.getByRole('button', { name: 'Unmute', exact: true }).click()
  await expect(audio).toHaveJSProperty('muted', false)
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
      configurable: true,
      get: () => 1,
      set: () => {},
    })
  })
  await page.reload()
  await ready(page)
  await expect(volume).toHaveCount(0)
  await expect(
    page.getByText("Use your device's volume buttons."),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Mute', exact: true }),
  ).toBeVisible()
})
test('controls wrap at 320 pixels with enlarged text and retain keyboard focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')
  await ready(page)
  await page.addStyleTag({ content: ':root { font-size: 200%; }' })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  const play = page.getByRole('button', { name: 'Play', exact: true })
  await page.locator('audio').evaluate((a: HTMLAudioElement) => {
    a.muted = true
  })
  await play.focus()
  await play.press('Space')
  await expect(
    page.getByRole('button', { name: 'Pause', exact: true }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Pause', exact: true }).press('Space')
  await expect(page.locator('audio')).toHaveJSProperty('paused', true)
})
