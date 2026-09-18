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
  await expect(page.locator('.media-status')).toHaveText(/^Playing\b/)
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
  const box = (await volume.boundingBox())!
  await volume.click({ position: { x: box.width / 2, y: box.height / 2 } })
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.volume))
    .toBeCloseTo(0.5, 1)
  await expect(audio).toHaveJSProperty('muted', false)
  await expect(page.locator('.volume-waves path')).toHaveCount(2)
  await page.getByRole('button', { name: 'Mute', exact: true }).click()
  await expect(audio).toHaveJSProperty('muted', true)
  await expect(page.locator('.volume-muted')).toBeVisible()
  await expect(page.locator('.volume-waves path')).toHaveCount(0)
  await page.getByRole('button', { name: 'Unmute', exact: true }).click()
  await expect(audio).toHaveJSProperty('muted', false)
  await expect(page.locator('.volume-waves path')).toHaveCount(2)
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
for (const [mode, userAgent, platform] of [
  [
    'mobile',
    'Mozilla/5.0 (iPad; CPU OS 14_3 like Mac OS X) AppleWebKit/605.1.15 Version/14.0.2 Mobile/15E148 Safari/604.1',
    'iPad',
  ],
  [
    'desktop',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/14.0.2 Safari/605.1.15',
    'MacIntel',
  ],
]) {
  test(`iPad ${mode} mode keeps mute without a misleading volume slider`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ userAgent, platform }) => {
        Object.defineProperties(navigator, {
          userAgent: { configurable: true, value: userAgent },
          platform: { configurable: true, value: platform },
          maxTouchPoints: { configurable: true, value: 5 },
        })
        // Emulate a setter that reads back successfully before asynchronously
        // reverting. An immediate write/read probe alone must not enable volume.
        const volumes = new WeakMap<HTMLMediaElement, number>()
        Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
          configurable: true,
          get() {
            return volumes.get(this) ?? 1
          },
          set(value: number) {
            volumes.set(this, value)
            document.documentElement.dataset.volumeWrites = 'yes'
            queueMicrotask(() => {
              volumes.set(this, 1)
              this.dispatchEvent(new Event('volumechange'))
            })
          },
        })
      },
      { userAgent, platform },
    )
    await page.goto('/episodes/trey-turner-ruminate')
    await ready(page)
    const audio = page.locator('audio')
    await expect(page.getByRole('slider', { name: 'Volume' })).toHaveCount(0)
    await expect(
      page.getByText("Use your device's volume buttons."),
    ).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('data-volume-writes')
    await page.getByRole('button', { name: 'Mute', exact: true }).click()
    await expect(audio).toHaveJSProperty('muted', true)
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(audio).toHaveJSProperty('paused', false)
    await page.getByRole('button', { name: 'Unmute', exact: true }).click()
    await expect(audio).toHaveJSProperty('muted', false)
    await expect(page.getByRole('slider', { name: 'Volume' })).toHaveCount(0)
  })
}

test('transport stays on one line and hides skips only when needed, including with enlarged text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')
  await ready(page)
  const targetSizes = () =>
    page.locator('.audio-controls button:visible').evaluateAll((buttons) =>
      buttons.map((button) => {
        const { width, height } = button.getBoundingClientRect()
        return { width, height }
      }),
    )
  for (const { width, height } of await targetSizes()) {
    expect(width).toBeGreaterThanOrEqual(44)
    expect(height).toBeGreaterThanOrEqual(44)
  }
  const skips = page.locator('.transport-row .skip-control')
  await expect(skips.first()).toBeHidden()
  await expect(skips.last()).toBeHidden()
  const expectSingleRow = async () => {
    const centers = await page
      .locator('.transport-row button:visible')
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.getBoundingClientRect()
          return box.y + box.height / 2
        }),
      )
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1)
  }
  await expect(page.locator('.transport-row button:visible')).toHaveCount(5)
  await expectSingleRow()
  await page.setViewportSize({ width: 600, height: 800 })
  await expect(skips.first()).toBeVisible()
  await expect(skips.last()).toBeVisible()
  await expect(page.locator('.transport-row button:visible')).toHaveCount(7)
  await expectSingleRow()
  await page.setViewportSize({ width: 320, height: 800 })
  await page.addStyleTag({ content: ':root { font-size: 200%; }' })
  for (const { width, height } of await targetSizes()) {
    expect(width).toBeGreaterThanOrEqual(44)
    expect(height).toBeGreaterThanOrEqual(44)
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await expect(skips.first()).toBeHidden()
  await expect(skips.last()).toBeHidden()
  await expectSingleRow()
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
