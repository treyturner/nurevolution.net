import { expect, test } from '@playwright/test'
import { hydrated, ready, stubArchiveMedia } from './media'
import { mediaBaseURL } from '../../playwright.config'

test.beforeEach(async ({ page }) => {
  await stubArchiveMedia(page)
  await page.addInitScript(() => {
    const trace: unknown[] = []
    Object.assign(window, { playerMediaTrace: trace })
    const record = (entry: object) => {
      if (trace.length < 500) trace.push({ at: performance.now(), ...entry })
    }
    // Record actual reads without introducing additional duration queries.
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'duration',
    )!
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      ...descriptor,
      get(this: HTMLMediaElement) {
        const duration = descriptor.get!.call(this)
        record({
          read: 'duration',
          value: String(duration),
          readyState: this.readyState,
          paused: this.paused,
          preload: this.preload,
          src: this.src,
          currentSrc: this.currentSrc,
        })
        return duration
      },
    })
    for (const event of [
      'loadstart',
      'durationchange',
      'loadedmetadata',
      'loadeddata',
      'canplay',
      'canplaythrough',
      'progress',
      'suspend',
      'stalled',
      'play',
      'playing',
      'pause',
      'waiting',
      'ended',
      'error',
    ]) {
      document.addEventListener(
        event,
        (event) => {
          if (event.target instanceof HTMLAudioElement)
            record({ event: event.type })
        },
        true,
      )
    }
  })
})

test.afterEach(async ({ page }, testInfo) => {
  if (!page.isClosed()) {
    const trace = await page.evaluate(() =>
      Reflect.get(window, 'playerMediaTrace'),
    )
    await testInfo.attach('player-media-events', {
      body: JSON.stringify(trace, null, 2),
      contentType: 'application/json',
    })
  }
})

test('keeps loading until metadata arrives, with playback still paused', async ({
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
    await expect(page.locator('.media-status')).toHaveText('Loading audio…')
    release()
    await ready(page)
    expect(
      await audio.evaluate((a: HTMLAudioElement) => a.duration),
    ).toBeGreaterThan(0)
    await expect(audio).toHaveJSProperty('paused', true)
    await expect(page.locator('.media-status')).toHaveText(
      'Press Play to listen.',
    )
    await audio.evaluate((a: HTMLAudioElement) => {
      a.muted = true
      a.loop = true
      void a.play()
    })
    await expect(page.locator('.media-status')).toHaveText('Playing')
    await audio.evaluate((a: HTMLAudioElement) => a.pause())
    await expect(page.locator('.media-status')).toHaveText(
      'Press Play to listen.',
    )
  } finally {
    release()
  }
})

test('reconciles duration that becomes positive only after the early metadata events', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'duration',
    )!
    const ready = new WeakSet<HTMLMediaElement>()
    // Reproduce the recorded WebKit ordering with real native media events:
    // durationchange/loadedmetadata report zero; loadeddata exposes duration.
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      ...descriptor,
      get(this: HTMLMediaElement) {
        return ready.has(this) ? descriptor.get!.call(this) : 0
      },
    })
    document.addEventListener(
      'loadedmetadata',
      (event) => {
        if (event.target instanceof HTMLAudioElement)
          document.documentElement.dataset.earlyDuration = String(
            event.target.duration,
          )
      },
      true,
    )
    document.addEventListener(
      'loadeddata',
      (event) => {
        if (event.target instanceof HTMLAudioElement) ready.add(event.target)
      },
      true,
    )
  })
  await page.goto('/episodes/trey-turner-lost-in-translation')
  await ready(page)
  await expect(page.locator('html')).toHaveAttribute('data-early-duration', '0')
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.duration),
    )
    .toBeGreaterThan(0)
  await expect(page.locator('.media-status')).toHaveText(
    'Press Play to listen.',
  )
  await expect(page.locator('audio')).toHaveJSProperty('paused', true)
  await expect(page.locator('audio')).toHaveJSProperty('currentTime', 0)
  await expect(page.locator('audio')).toHaveAttribute('preload', 'metadata')
})

test('recovers stalled metadata automatically and shows duration without a Play request', async ({
  page,
}) => {
  await page.clock.install()
  let release!: () => void
  let requested!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const firstRequest = new Promise<void>((resolve) => {
    requested = resolve
  })
  let attempts = 0
  await page.route('https://podcast.nurevolution.net/**', async (route) => {
    if (++attempts === 1) {
      requested()
      await gate
      await route.abort()
    } else await route.fallback()
  })
  try {
    await page.goto('/episodes/trey-turner-lost-in-translation', {
      waitUntil: 'domcontentloaded',
    })
    await hydrated(page)
    await firstRequest
    const audio = page.locator('audio')
    await expect(audio).toHaveJSProperty('readyState', 0)
    await expect(page.locator('.media-status')).toHaveText('Loading audio…')
    await page.clock.fastForward(10_000)
    await ready(page)
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(
      await audio.evaluate((a: HTMLAudioElement) => a.duration),
    ).toBeGreaterThan(0)
    await expect(audio).toHaveJSProperty('paused', true)
    await expect(audio).toHaveJSProperty('currentTime', 0)
    await expect(page.locator('.media-status')).toHaveText(
      'Press Play to listen.',
    )
  } finally {
    release()
  }
})

for (const recovery of ['late metadata', 'Play', 'Play then pause']) {
  test(`deferred preload recovers through ${recovery} without a false error`, async ({
    page,
  }) => {
    await page.clock.install()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let attempts = 0
    await page.route('https://podcast.nurevolution.net/**', async (route) => {
      attempts++
      await gate
      await route.fallback()
    })
    try {
      await page.goto('/episodes/trey-turner-lost-in-translation', {
        waitUntil: 'domcontentloaded',
      })
      await hydrated(page)
      await expect.poll(() => attempts).toBeGreaterThanOrEqual(1)
      await page.clock.fastForward(10_000)
      await expect.poll(() => attempts).toBeGreaterThanOrEqual(2)
      await page.clock.fastForward(10_000)
      const audio = page.locator('audio')
      await expect(page.locator('.media-status')).toHaveText(
        'Audio is taking longer to load.',
      )
      await expect(
        page.getByRole('button', { name: 'Retry audio' }),
      ).toBeVisible()
      await expect(audio).toHaveJSProperty('error', null)
      await expect(audio).toHaveJSProperty('paused', true)
      const loads = attempts
      if (recovery !== 'late metadata') {
        await audio.evaluate((a: HTMLAudioElement) => {
          a.muted = true
          a.loop = true
          void a.play()
        })
        await expect(page.locator('.media-status')).toHaveText('Buffering…')
      }
      if (recovery === 'Play then pause') {
        await audio.evaluate((a: HTMLAudioElement) => a.pause())
        await expect(page.locator('.media-status')).toHaveText('Loading audio…')
        await page.clock.fastForward(10_000)
        await expect(page.locator('.media-status')).toHaveText(
          'Audio is taking longer to load.',
        )
        await expect(
          page.getByRole('button', { name: 'Retry audio' }),
        ).toBeVisible()
      }
      const startPlayback = recovery === 'Play'
      await page.clock.fastForward(30_000)
      expect(attempts).toBe(loads)
      await expect(audio).toHaveJSProperty('paused', !startPlayback)
      release()
      await ready(page)
      await expect(page.locator('.media-status')).toHaveText(
        startPlayback ? 'Playing' : 'Press Play to listen.',
      )
      await expect(
        page.getByRole('button', { name: 'Retry audio' }),
      ).toHaveCount(0)
      await expect(audio).toHaveJSProperty('paused', !startPlayback)
      expect(
        await audio.evaluate((a: HTMLAudioElement) => a.duration),
      ).toBeGreaterThan(0)
    } finally {
      release()
    }
  })
}

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
