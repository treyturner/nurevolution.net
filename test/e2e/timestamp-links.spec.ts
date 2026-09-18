import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fulfillAudio, hydrated, ready, stubArchiveMedia } from './media'
import { resumeKey, visitKey } from '../../app/services/playback-storage'

const praxis = '/episodes/trey-turner-praxis'
const ruminate = '/episodes/trey-turner-ruminate'
const long = await readFile(
  new URL('../fixtures/media-app/public/long.wav', import.meta.url),
)

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

test('copying positions and timed tracks preserves playback and canonical fractional values', async ({
  page,
}) => {
  await page.goto(ruminate + '?t=8.25')
  await at(page, 8.25)
  await page
    .getByRole('button', { name: 'Copy timestamp link', exact: true })
    .click()
  await expect(page.locator('html')).toHaveAttribute(
    'data-copied',
    'https://nurevolution.net' + ruminate + '?t=8.25',
  )
  await expect(page.locator('.copy-link-toast')).toHaveText(
    'Timestamp link copied',
  )
  await page.getByRole('button', { name: /^Copy link to track 2:/ }).click()
  await expect(page.locator('html')).toHaveAttribute(
    'data-copied',
    'https://nurevolution.net' + ruminate + '?t=' + String(7695011 / 44100),
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
    'https://nurevolution.net' + praxis + '?t=8.25',
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
