import { expect, test, type Page, type Route } from '@playwright/test'
import { ready, stubArchiveMedia } from './media'

async function layout(page: Page) {
  return page.evaluate(() => {
    const feedback = document.querySelector('.player-feedback')!
    const description = document.querySelector('.description')!
    return {
      height: feedback.getBoundingClientRect().height,
      descriptionTop: description.getBoundingClientRect().top + window.scrollY,
    }
  })
}

for (const [width, scale] of [
  [1440, 100],
  [390, 100],
  [320, 100],
  [320, 200],
  [390, 200],
] as const) {
  test(`error feedback stays in place at ${width}px with ${scale}% text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await stubArchiveMedia(page)
    await page.addInitScript((size) => {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = size + '%'
      })
    }, scale)
    await page.goto('/episodes/trey-turner-ruminate')
    await ready(page)
    await expect(page.locator('.media-status')).toHaveText(
      'Press Play to listen.',
    )
    const before = await layout(page)
    const unchanged = async () => {
      const after = await layout(page)
      expect(after.height).toBeCloseTo(before.height, 1)
      expect(after.descriptionTop).toBeCloseTo(before.descriptionTop, 1)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width)
    }
    const error = async (message: string) => {
      await expect(page.locator('.media-status')).toHaveText(message)
      await expect(page.locator('.media-status')).toHaveAttribute(
        'role',
        'status',
      )
      await expect(page.locator('.media-status')).toHaveCSS(
        'color',
        'rgb(255, 180, 171)',
      )
      await unchanged()
    }

    await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'currentTime',
      )!
      Object.defineProperty(audio, 'currentTime', {
        configurable: true,
        get() {
          return descriptor.get!.call(this)
        },
        set() {
          throw new DOMException('Seek unavailable', 'InvalidStateError')
        },
      })
    })
    await page
      .getByRole('slider', { name: 'Playback position' })
      .press('PageUp')
    await error('Could not seek. Try again.')
    await expect(page.locator('.status-retry')).toHaveCount(0)

    // Native error state is controlled here so Firefox's decoded-media cache
    // cannot bypass a failed request on reload. The media-failure test covers
    // real 404 recovery separately.
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
      Reflect.deleteProperty(audio, 'currentTime')
      Object.defineProperty(audio, 'error', {
        configurable: true,
        value: { code: 2 },
      })
      audio.dispatchEvent(new Event('error'))
    })
    await error('Audio could not be loaded.')
    const retry = page.getByRole('button', { name: 'Retry audio' })
    const box = await retry.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await page
      .locator('audio')
      .evaluate((audio) => Reflect.deleteProperty(audio, 'error'))
    await retry.click()
    await ready(page)
    await expect(page.locator('.media-status')).toHaveText(
      'Press Play to listen.',
    )
    await expect(page.locator('.player-feedback-error')).toHaveCount(0)
    await expect(retry).toHaveCount(0)
    await unchanged()

    const failEpisode = (route: Route) =>
      route.fulfill({ status: 503, json: { statusCode: 503 } })
    await page.route('**/api/episodes/*', failEpisode)
    await page
      .getByRole('button', { name: 'Next episode', exact: true })
      .click()
    await error('Episode could not be loaded.')
    await expect(page.locator('.navigation-error')).toHaveCount(0)
    await expect(page.locator('h1')).toHaveText('Ruminate')
    const retryEpisode = page.getByRole('link', { name: 'Retry episode' })
    await expect(retryEpisode).toBeVisible()
    await page.unroute('**/api/episodes/*', failEpisode)
    await retryEpisode.click()
    await expect(page.locator('h1')).not.toHaveText('Ruminate')
    await ready(page)
    await expect(page.locator('.player-feedback-error')).toHaveCount(0)
  })
}

test('download stays below changing phone statuses and beside short desktop statuses', async ({
  page,
}) => {
  await stubArchiveMedia(page)
  await page.goto('/episodes/trey-turner-impulse')
  await ready(page)
  const measurements = () =>
    page.evaluate(() => {
      const feedback = document
        .querySelector('.player-feedback')!
        .getBoundingClientRect()
      const status = document.querySelector('.media-status')!
      const text = status.getBoundingClientRect()
      const link = document
        .querySelector('.player-links')!
        .getBoundingClientRect()
      return {
        feedback: { top: feedback.top, bottom: feedback.bottom },
        text: { height: text.height },
        link: { top: link.top },
        lineHeight: Number.parseFloat(getComputedStyle(status).lineHeight),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }
    })
  for (const noGap of [false, true]) {
    await page.evaluate((noGap) => {
      document.documentElement.classList.toggle('no-flex-gap', noGap)
      document.querySelector('.media-status')!.textContent =
        'Playing 1/16: Sinic - One Makes One'
    }, noGap)
    await page.setViewportSize({ width: 412, height: 900 })
    const narrow = await measurements()
    expect(narrow.link.top).toBeGreaterThanOrEqual(narrow.feedback.bottom)
    expect(narrow.text.height).toBeLessThanOrEqual(narrow.lineHeight + 1)
    expect(narrow.overflow).toBe(false)
    for (const message of [
      'Loading audio…',
      'Press Play to listen.',
      'Playing 1/16: Sinic - One Makes One',
    ]) {
      await page.locator('.media-status').evaluate((element, message) => {
        element.textContent = message
      }, message)
      const current = await measurements()
      expect(current.link.top).toBeGreaterThanOrEqual(current.feedback.bottom)
      expect(current.link.top - current.feedback.top).toBeCloseTo(
        narrow.link.top - narrow.feedback.top,
        1,
      )
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    const wide = await measurements()
    expect(wide.link.top).toBeLessThan(wide.feedback.bottom)
    expect(wide.text.height).toBeLessThanOrEqual(wide.lineHeight + 1)
    await page.setViewportSize({ width: 390, height: 900 })
    await page.evaluate(() => {
      document.querySelector('.media-status')!.textContent =
        'Playing 1/16: An artist with a long name - A very long track title that must wrap even after the download link moves below'
    })
    const long = await measurements()
    expect(long.link.top).toBeGreaterThanOrEqual(long.feedback.bottom)
    expect(long.overflow).toBe(false)
  }
})
