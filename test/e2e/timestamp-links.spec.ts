import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fulfillAudio, hydrated, ready, stubArchiveMedia } from './media'
import { resumeKey, visitKey } from '../../app/services/playback-storage'
import {
  devBaseURL,
  devWebOrigin,
  devMediaOrigin,
} from '../../playwright.config'

const praxis = '/episodes/trey-turner-praxis'
const ruminate = '/episodes/trey-turner-ruminate'
const long = await readFile(
  new URL('../fixtures/media-app/public/long.wav', import.meta.url),
)

async function rightClickThumb(page: Page) {
  const slider = page.getByRole('slider', { name: 'Playback position' })
  const position = await slider.evaluate((input: HTMLInputElement) => {
    const box = input.getBoundingClientRect()
    const size = Number.parseFloat(
      getComputedStyle(input).getPropertyValue('--playhead-size'),
    )
    return {
      x:
        size / 2 +
        ((box.width - size) * Number(input.value)) / Number(input.max),
      y: box.height / 2,
    }
  })
  await slider.click({ button: 'right', position })
}

async function routeTo(page: Page, url: string) {
  await page.evaluate((url) => {
    const root = document.getElementById('__nuxt') as HTMLElement & {
      __vue_app__: {
        $nuxt: { $router: { push(url: string): Promise<unknown> } }
      }
    }
    void root.__vue_app__.$nuxt.$router.push(url)
  }, url)
}
async function at(page: Page, seconds: number) {
  await ready(page)
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeCloseTo(seconds, 3)
  await expect(page.locator('audio')).toHaveJSProperty('paused', true)
}
test.beforeEach(async ({ page }) => {
  await stubArchiveMedia(page)
  await page.route('https://podcast.nurevolution.net/**', (route) =>
    fulfillAudio(route, long, 'audio/wav'),
  )
  await page.addInitScript(
    ({ resumeKey, visitKey }) => {
      localStorage.setItem(
        visitKey,
        JSON.stringify({ schemaVersion: 1, lastVisitedAt: Date.now() }),
      )
      localStorage.setItem(
        resumeKey,
        JSON.stringify({
          schemaVersion: 1,
          episodeId: 'wp-417',
          positionSeconds: 22,
          updatedAt: Date.now(),
        }),
      )
      const original = HTMLMediaElement.prototype.load
      HTMLMediaElement.prototype.load = function () {
        document.documentElement.dataset.loads = String(
          Number(document.documentElement.dataset.loads ?? 0) + 1,
        )
        return original.call(this)
      }
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (value: string) => {
            document.documentElement.dataset.copied = value
          },
        },
        configurable: true,
      })
    },
    { resumeKey, visitKey },
  )
})

test('explicit fractional times and zero beat saved progress while plain URLs retain restoration', async ({
  page,
}) => {
  for (const [query, target] of [
    ['?t=8.254', 8.254],
    ['?t=0', 0],
    ['', 22],
    ['?t=5000', 40],
  ] as const) {
    await page.goto(praxis + query)
    await at(page, target)
    await expect(page.locator('html')).toHaveAttribute('data-loads', '1')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://nurevolution.net' + praxis,
    )
  }
  await page.goto('/?t=8.254')
  await expect(page).toHaveURL(new RegExp(praxis + '$'))
  await at(page, 22)
})

test('invalid timestamps suppress saved progress without breaking the episode', async ({
  page,
}) => {
  for (const query of ['?t=', '?t=-2', '?t=1&t=2', '?t=1e2', '?t=%20']) {
    await page.goto(praxis + query)
    await at(page, 0)
    await expect(page.locator('.media-status')).toHaveText(
      'Invalid timestamp; starting at 0:00.',
    )
  }
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 5
  })
  await routeTo(page, praxis + '?t=another-invalid-value')
  await at(page, 0)
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.muted = true
  })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('.media-status')).toHaveText(/^Playing\b/)
})

test('a failed episode request replaces an invalid timestamp warning and can be retried', async ({
  page,
}) => {
  await page.goto(praxis + '?t=invalid')
  await at(page, 0)
  await expect(page.locator('.media-status')).toHaveText(
    'Invalid timestamp; starting at 0:00.',
  )
  await page.route('**/api/episodes/*', (route) =>
    route.fulfill({ status: 503, json: { statusCode: 503 } }),
  )
  await routeTo(page, ruminate)
  await expect(page.locator('.media-status')).toHaveText(
    'Episode could not be loaded.',
  )
  await expect(page.locator('h1')).toHaveText('Praxis')
  await page.unroute('**/api/episodes/*')
  await page.getByRole('link', { name: 'Retry episode' }).click()
  await expect(page.locator('h1')).toHaveText('Ruminate')
  await at(page, 0)
  await expect(page.locator('.media-status')).toHaveText(
    'Press Play to listen.',
  )
})

test('same-episode time links and history seek once; other query and hash edits leave playback alone', async ({
  page,
}) => {
  await page.goto(praxis + '?t=8.25')
  await at(page, 8.25)
  const audio = await page.locator('audio').elementHandle()
  await audio!.evaluate((element: HTMLAudioElement) => {
    element.muted = true
  })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  await routeTo(page, praxis + '?t=8.25&source=test#tracks')
  await expect(page).toHaveURL(/source=test#tracks$/)
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  await routeTo(page, praxis + '?t=12.375')
  await at(page, 12.375)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goBack()
  await at(page, 8.25)
  await page.goForward()
  await at(page, 12.375)
  expect(
    await audio!.evaluate(
      (element) => element === document.querySelector('audio'),
    ),
  ).toBe(true)
  await expect(page.locator('html')).toHaveAttribute('data-loads', '1')
})

test('cross-episode time links honor cancellation, then commit paused at the shared position', async ({
  page,
}) => {
  await page.goto(praxis + '?t=8.25')
  await at(page, 8.25)
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.muted = true
  })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  await routeTo(page, ruminate + '?t=12.125')
  await page.getByRole('button', { name: 'Keep listening' }).click()
  await expect(page).toHaveURL(new RegExp(praxis + '\\?t=8.25$'))
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  await expect(page.locator('html')).toHaveAttribute('data-loads', '1')
  await routeTo(page, ruminate + '?t=12.125')
  await page
    .getByRole('button', { name: 'Change episode', exact: true })
    .click()
  await expect(page.locator('h1')).toHaveText('Ruminate')
  await at(page, 12.125)
  await expect(page.locator('html')).toHaveAttribute('data-loads', '2')
})

test('copying positions and timed tracks preserves playback and uses the current origin with fractional values', async ({
  page,
}) => {
  await page.goto(ruminate + '?t=8.25')
  await at(page, 8.25)
  await expect(
    page.getByRole('menuitem', { name: 'Copy timestamp link' }),
  ).toHaveCount(0)
  await rightClickThumb(page)
  await page
    .getByRole('menuitem', { name: 'Copy timestamp link', exact: true })
    .click()
  await expect(page.locator('html')).toHaveAttribute(
    'data-copied',
    new URL(page.url()).origin + ruminate + '?t=8.25',
  )
  await expect(page.locator('.copy-link-toast')).toHaveText(
    'Timestamp link copied',
  )
  await page.getByRole('button', { name: /^Copy link to track 2:/ }).click()
  await expect(page.locator('html')).toHaveAttribute(
    'data-copied',
    new URL(page.url()).origin + ruminate + '?t=' + String(7695011 / 44100),
  )
  await at(page, 8.25)
  expect(await page.locator('.track-row button').count()).toBe(0)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined })
  })
  await page.getByRole('button', { name: /^Copy link to track 3:/ }).click()
  await expect(page.locator('.copy-link-toast').last()).toHaveText(
    'Couldn’t copy link. Please try again.',
  )
  await at(page, 8.25)
})

test('playhead menu supports keyboard access, dismissal and narrow screens without interrupting playback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto(ruminate + '?t=8.25')
  await at(page, 8.25)
  const slider = page.getByRole('slider', { name: 'Playback position' })
  const menu = page.getByRole('menu', { name: 'Playback position actions' })
  const copy = page.getByRole('menuitem', { name: 'Copy timestamp link' })
  await expect(page.locator('.player-links')).toHaveText('Download MP3')
  await slider.focus()
  await slider.press('Shift+F10')
  await expect(copy).toBeFocused()
  await copy.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(slider).toBeFocused()
  await slider.press('Shift+F10')
  await copy.press('Enter')
  await expect(page.locator('html')).toHaveAttribute(
    'data-copied',
    new URL(page.url()).origin + ruminate + '?t=8.25',
  )
  await at(page, 8.25)
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.muted = true
  })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  await rightClickThumb(page)
  await expect(copy).toBeFocused()
  const box = (await menu.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(8)
  expect(box.y).toBeGreaterThanOrEqual(8)
  expect(box.x + box.width).toBeLessThanOrEqual(312)
  expect(box.y + box.height).toBeLessThanOrEqual(632)
  await copy.click()
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  const copied = await page.locator('html').getAttribute('data-copied')
  expect(Number(new URL(copied!).searchParams.get('t'))).toBeGreaterThanOrEqual(
    8.25,
  )
  await rightClickThumb(page)
  await page.locator('h1').click()
  await expect(menu).toHaveCount(0)
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
})

test('only the thumb opens timestamp copying, while the rest of the bar still seeks normally', async ({
  page,
}) => {
  await page.goto(ruminate + '?t=0')
  await at(page, 0)
  const slider = page.getByRole('slider', { name: 'Playback position' })
  const menu = page.getByRole('menu', { name: 'Playback position actions' })
  for (const seconds of [0, 20, 40]) {
    await routeTo(page, ruminate + '?t=' + seconds)
    await at(page, seconds)
    const box = (await slider.boundingBox())!
    await slider.click({
      button: 'right',
      position: {
        x: box.width * (seconds < 20 ? 0.75 : 0.25),
        y: box.height / 2,
      },
    })
    await expect(menu).toHaveCount(0)
    await page.locator('.player-time').first().click({ button: 'right' })
    await expect(menu).toHaveCount(0)
    await rightClickThumb(page)
    await expect(menu).toBeVisible()
    await page
      .getByRole('menuitem', { name: 'Copy timestamp link' })
      .press('Escape')
    await at(page, seconds)
  }
  await slider.click()
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeCloseTo(20, 0)
  await expect(menu).toHaveCount(0)
  await expect(page.locator('audio')).toHaveJSProperty('paused', true)
})

test('touch holds have a larger thumb target while mouse clicks and distant touches stay excluded', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(ruminate + '?t=20')
  await at(page, 20)
  const slider = page.getByRole('slider', { name: 'Playback position' })
  await slider.scrollIntoViewIfNeeded()
  const box = (await slider.boundingBox())!
  const menu = page.getByRole('menu', { name: 'Playback position actions' })
  await slider.click({
    button: 'right',
    position: { x: box.width / 2 + 12, y: box.height / 2 },
  })
  await expect(menu).toHaveCount(0)
  await page.clock.install()
  const hold = (offset: number) =>
    slider.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      isPrimary: true,
      clientX: box.x + box.width / 2 + offset,
      clientY: box.y + box.height / 2,
    })
  await hold(12)
  await page.clock.fastForward(650)
  await expect(menu).toBeVisible()
  await slider.dispatchEvent('pointerup')
  await page.getByRole('menuitem', { name: 'Copy timestamp link' }).click()
  await expect(page.locator('html')).toHaveAttribute(
    'data-copied',
    new URL(page.url()).origin + ruminate + '?t=20',
  )
  await at(page, 20)
  await hold(24)
  await page.clock.fastForward(650)
  await expect(menu).toHaveCount(0)
  await slider.dispatchEvent('pointerup')
  await hold(12)
  await slider.dispatchEvent('pointermove', {
    clientX: box.x + box.width / 2 + 28,
    clientY: box.y + box.height / 2,
  })
  await page.clock.fastForward(650)
  await expect(menu).toHaveCount(0)
  await slider.dispatchEvent('pointerup')
})

for (const environment of ['dev delivery', 'HTTPS preview'] as const) {
  test(`timestamp copies round trip within the ${environment} origin`, async ({
    page,
    baseURL,
  }) => {
    const origin =
      environment === 'dev delivery'
        ? devBaseURL
        : 'https://timestamp-preview.example.test'
    if (environment === 'dev delivery') {
      await stubArchiveMedia(page, { web: devWebOrigin, media: devMediaOrigin })
      await page.route(devMediaOrigin + '/**', (route) =>
        fulfillAudio(route, long, 'audio/wav'),
      )
    } else {
      // Model an HTTPS proxy serving the same build from a differently named backend.
      await page.route(origin + '/**', async (route) => {
        const requested = new URL(route.request().url())
        const response = await route.fetch({
          url: new URL(requested.pathname + requested.search, baseURL).href,
        })
        await route.fulfill({ response })
      })
    }
    await page.goto(origin + ruminate + '?t=8.25&source=test#tracks')
    await at(page, 8.25)
    await rightClickThumb(page)
    await page.getByRole('menuitem', { name: 'Copy timestamp link' }).click()
    const copied = await page.locator('html').getAttribute('data-copied')
    expect(copied).toBe(origin + ruminate + '?t=8.25')
    await page.goto(copied!)
    await at(page, 8.25)
    await page.getByRole('button', { name: /^Copy link to track 1:/ }).click()
    const track = await page.locator('html').getAttribute('data-copied')
    expect(track).toBe(origin + ruminate + '?t=0')
    await page.goto(track!)
    await at(page, 0)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://nurevolution.net' + ruminate,
    )
  })
}

test('delayed metadata retains the newest link and honors a later Play request', async ({
  page,
}) => {
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('https://podcast.nurevolution.net/**', async (route) => {
    await waiting
    await fulfillAudio(route, long, 'audio/wav')
  })
  try {
    await page.goto(praxis + '?t=8.25', { waitUntil: 'domcontentloaded' })
    await hydrated(page)
    await routeTo(page, praxis + '?t=18.75')
    await expect(page).toHaveURL(/t=18.75$/)
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
      audio.muted = true
    })
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    release()
    await expect(page.locator('.media-status')).toHaveText(/^Playing\b/)
    await expect
      .poll(() =>
        page
          .locator('audio')
          .evaluate((audio: HTMLAudioElement) => audio.currentTime),
      )
      .toBeGreaterThanOrEqual(18.75 - 0.001)
    await expect(page.locator('html')).toHaveAttribute('data-loads', '1')
  } finally {
    release()
  }
})

test('track links omit unknown starts and reflow without nested controls or displaced highlights', async ({
  page,
}) => {
  await page.route('**/api/episodes/trey-turner-praxis', async (route) => {
    const response = await route.fetch()
    const detail = await response.json()
    await route.fulfill({
      json: {
        ...detail,
        tracks: [0, 8.25, null, 32].map((startTime, i) => ({
          position: i + 1,
          artist: 'Test artist',
          title: 'Test track',
          startTime,
        })),
      },
    })
  })
  await page.goto(ruminate + '?t=0')
  await at(page, 0)
  await routeTo(page, praxis + '?t=0')
  await expect(page.locator('h1')).toHaveText('Praxis')
  await at(page, 0)
  await expect(page.locator('.track-list .timestamp-copy')).toHaveCount(3)
  await expect(
    page.locator('.track-list li').nth(2).locator('.timestamp-copy'),
  ).toHaveCount(0)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.addStyleTag({ content: ':root { font-size: 200% }' })
  await page.getByRole('tab', { name: 'Tracklist', exact: true }).click()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  const rows = await page
    .locator('.track-number')
    .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().left))
  expect(new Set(rows).size).toBe(1)
  for (const width of await page
    .locator('.timestamp-copy')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().width),
    ))
    expect(width).toBeGreaterThanOrEqual(44)
  await page.getByRole('button', { name: /^Copy link to track 2:/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute(
    'data-copied',
    new URL(page.url()).origin + praxis + '?t=8.25',
  )
  await at(page, 0)
})

test('a new time link cancels an older episode request without a stale seek or source load', async ({
  page,
}) => {
  await page.goto(ruminate + '?t=8.25')
  await at(page, 8.25)
  let release!: () => void, requested!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    requested = resolve
  })
  await page.route('**/api/episodes/trey-turner-praxis', async (route) => {
    requested()
    await waiting
    await route.continue().catch(() => {})
  })
  try {
    await routeTo(page, praxis + '?t=15.25')
    await started
    await routeTo(page, ruminate + '?t=12.375')
    await expect(page).toHaveURL(new RegExp(ruminate + '\\?t=12.375$'))
    release()
    await at(page, 12.375)
    await expect(page.locator('h1')).toHaveText('Ruminate')
    await expect(page.locator('html')).toHaveAttribute('data-loads', '1')
  } finally {
    release()
  }
})
