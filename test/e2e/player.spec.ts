import { expect, test } from '@playwright/test'
import { hydrated, ready, stubArchiveMedia } from './media'
import { mediaBaseURL } from '../../playwright.config'

test.beforeEach(async ({ page }) => stubArchiveMedia(page))

test('offers Play before delayed metadata arrives and reports buffering only after playback starts', async ({
  page,
}) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('https://podcast.nurevolution.net/**', async (route) => {
    await gate
    await route.fallback()
  })
  try {
    await page.goto('/episodes/trey-turner-lost-in-translation', {
      waitUntil: 'domcontentloaded',
    })
    await hydrated(page)
    const audio = page.locator('audio')
    await expect(audio).toHaveJSProperty('readyState', 0)
    await expect(audio).toHaveJSProperty('paused', true)
    await expect(page.locator('.media-status')).toHaveText(
      'Press Play to listen.',
    )
    await audio.evaluate((a: HTMLAudioElement) => {
      a.muted = true
      a.loop = true
      void a.play()
    })
    await expect(page.locator('.media-status')).toHaveText('Buffering…')
    release()
    await expect(page.locator('.media-status')).toHaveText('Playing')
    await audio.evaluate((a: HTMLAudioElement) => a.pause())
    await expect(page.locator('.media-status')).toHaveText(
      'Press Play to listen.',
    )
  } finally {
    release()
  }
})

test('fresh root, deep links and refresh load once and never initiate playback', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      document.documentElement.dataset.playCalls = String(
        Number(document.documentElement.dataset.playCalls ?? 0) + 1,
      )
      return original.call(this)
    }
  })
  for (const path of ['/', '/episodes/trey-turner-praxis']) {
    await page.goto(path)
    await ready(page)
    expect(
      await page.locator('audio').evaluate((a: HTMLAudioElement) => ({
        paused: a.paused,
        time: a.currentTime,
      })),
    ).toEqual({ paused: true, time: 0 })
    expect(
      await page.locator('html').getAttribute('data-play-calls'),
    ).toBeNull()
  }
  await page.reload()
  await ready(page)
  expect(await page.locator('html').getAttribute('data-play-calls')).toBeNull()
  await expect(page.locator('h1')).toHaveText('Praxis')
})

test('keeps one native element through paused/active selection and Back/Forward', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  const audio = await page.locator('audio').elementHandle()
  await page.locator('a[href="/episodes/trey-turner-praxis"]').click()
  await expect(page.locator('h1')).toHaveText('Praxis')
  await ready(page)
  expect(
    await audio!.evaluate(
      (a: HTMLAudioElement) =>
        a.isConnected && a === document.querySelector('audio'),
    ),
  ).toBe(true)
  expect(await audio!.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await audio!.evaluate(async (a: HTMLAudioElement) => {
    a.muted = true
    a.loop = true
    await a.play()
  })
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await page.locator('a[href="/episodes/trey-turner-ruminate"]').click()
  await expect(page.locator('h1')).toHaveText('Ruminate')
  await expect
    .poll(() => audio!.evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(false)
  await ready(page)
  await expect
    .poll(() => audio!.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(0.25)
  await audio!.evaluate((a: HTMLAudioElement) => a.pause())
  const position = await audio!.evaluate((a: HTMLAudioElement) => a.currentTime)
  await page.locator('a[href="/episodes/trey-turner-ruminate"]').click()
  expect(
    await audio!.evaluate((a: HTMLAudioElement) => a.currentTime),
  ).toBeCloseTo(position, 2)
  await page.goBack()
  await expect(page.locator('h1')).toHaveText('Praxis')
  await ready(page)
  expect(await audio!.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await page.goForward()
  await expect(page.locator('h1')).toHaveText('Ruminate')
  expect(await audio!.evaluate((a: HTMLAudioElement) => a.isConnected)).toBe(
    true,
  )
})

test('latest requested episode wins; failed navigation leaves a usable current player and retry', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/episodes/trey-turner-praxis', async (route) => {
    await gate
    await route.continue()
  })
  await page.locator('a[href="/episodes/trey-turner-praxis"]').click()
  await expect(page.locator('[aria-busy="true"]')).toHaveAttribute(
    'href',
    '/episodes/trey-turner-praxis',
  )
  await page.locator('a[href="/episodes/trey-turner-the-dark-prophet"]').click()
  await expect(page.locator('h1')).toHaveText('The Dark Prophet')
  release()
  await page.unroute('**/api/episodes/trey-turner-praxis')
  await page.route('**/api/episodes/trey-turner-praxis', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"statusCode":503}',
    }),
  )
  await page.locator('a[href="/episodes/trey-turner-praxis"]').click()
  await expect(page.getByRole('alert')).toContainText('Could not load')
  await expect(page.locator('h1')).toHaveText('The Dark Prophet')
  await page.unroute('**/api/episodes/trey-turner-praxis')
  await page.getByRole('link', { name: 'Try again' }).click()
  await expect(page.locator('h1')).toHaveText('Praxis')
})

test('recovers from an actual media failure without starting on retry', async ({
  page,
}) => {
  await page.route('https://podcast.nurevolution.net/**', (route) =>
    route.fulfill({ status: 404, body: 'Unavailable' }),
  )
  await page.goto('/')
  await hydrated(page)
  await expect(page.locator('.media-status')).toContainText(
    'Audio could not be loaded',
  )
  await page.unroute('https://podcast.nurevolution.net/**')
  await stubArchiveMedia(page)
  await page.getByRole('button', { name: 'Retry audio' }).click()
  await ready(page)
  expect(
    await page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused),
  ).toBe(true)
})

test('production player decodes the local MP3, plays to its natural end, and disposes', async ({
  page,
}) => {
  await page.goto(`${mediaBaseURL}/player-test`)
  await ready(page)
  await page.locator('audio').evaluate((a: HTMLAudioElement) => {
    a.muted = true
  })
  await page.getByRole('button', { name: 'Play fixture' }).click()
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await expect(page.locator('.media-status')).toHaveText('Episode finished.')
  expect(
    await page.locator('audio').evaluate((a: HTMLAudioElement) => a.ended),
  ).toBe(true)
  await page.getByRole('button', { name: 'Toggle player' }).click()
  await expect(page.locator('audio')).toHaveCount(0)
})
