import { expect, test, type Page } from '@playwright/test'
import { hydrated, ready, stubArchiveMedia } from './media'
import { resumeKey, visitKey } from '../../app/services/playback-storage'
const praxis = '/episodes/trey-turner-praxis'
const ruminate = '/episodes/trey-turner-ruminate'

async function seed(
  page: Page,
  episodeId = 'wp-417',
  positionSeconds = 0.75,
  age = 0,
) {
  await page.addInitScript(
    ({ resumeKey, visitKey, episodeId, positionSeconds, age }) => {
      if (!sessionStorage.getItem('resume-seeded')) {
        localStorage.setItem(
          visitKey,
          JSON.stringify({ schemaVersion: 1, lastVisitedAt: Date.now() - age }),
        )
        localStorage.setItem(
          resumeKey,
          JSON.stringify({
            schemaVersion: 1,
            episodeId,
            positionSeconds,
            updatedAt: Date.now() - age,
          }),
        )
        sessionStorage.setItem('resume-seeded', 'yes')
      }
      const original = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function () {
        document.documentElement.dataset.playCalls = String(
          Number(document.documentElement.dataset.playCalls ?? 0) + 1,
        )
        return original.call(this)
      }
    },
    { resumeKey, visitKey, episodeId, positionSeconds, age },
  )
}
async function position(page: Page, expected: number) {
  await ready(page)
  await expect
    .poll(() =>
      page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeCloseTo(expected, 1)
  await expect(page.locator('audio')).toHaveJSProperty('paused', true)
  expect(await page.locator('html').getAttribute('data-play-calls')).toBeNull()
}
test.beforeEach(async ({ page }) => {
  await stubArchiveMedia(page)
})

test('root restores by stable ID with one source load and replaces history; refresh stays paused', async ({
  page,
}) => {
  await seed(page)
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.load
    HTMLMediaElement.prototype.load = function () {
      document.documentElement.dataset.loads = String(
        Number(document.documentElement.dataset.loads ?? 0) + 1,
      )
      return original.call(this)
    }
  })
  await page.goto('/')
  await expect(page).toHaveURL(new RegExp(praxis + '$'))
  await position(page, 0.75)
  expect(await page.locator('html').getAttribute('data-loads')).toBe('1')
  await expect(page.locator('h1')).toHaveText('Praxis')
  await page.reload()
  await position(page, 0.75)
  expect(await page.locator('html').getAttribute('data-loads')).toBe('1')
})

test('explicit matching link restores position without a second detail request; another link starts at zero', async ({
  page,
}) => {
  await seed(page)
  const details: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/episodes/')) details.push(request.url())
  })
  await page.goto(praxis)
  await position(page, 0.75)
  expect(details).toEqual([])
  await page.goto(ruminate)
  await position(page, 0)
  await expect(page.locator('h1')).toHaveText('Ruminate')
})

test('paused native seeking is saved and restored on refresh without a Play request', async ({
  page,
}) => {
  await seed(page, 'wp-417', 0)
  await page.goto(praxis)
  await ready(page)
  // WebKit can expose readyState before finite duration. Let the initial zero
  // restore settle before simulating a separate native seek.
  await expect(
    page.getByRole('slider', { name: 'Playback position' }),
  ).toBeEnabled()
  await expect(page.locator('audio')).toHaveJSProperty('seeking', false)
  await page.locator('audio').evaluate((a: HTMLAudioElement) => {
    a.currentTime = 1.1
  })
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).positionSeconds,
        resumeKey,
      ),
    )
    .toBeCloseTo(1.1, 1)
  await page.reload()
  await position(page, 1.1)
})

test('saved time beyond the decoded duration clamps at the end, paused', async ({
  page,
}) => {
  await seed(page, 'wp-417', 500)
  await page.goto(praxis)
  await ready(page)
  const duration = await page
    .locator('audio')
    .evaluate((a: HTMLAudioElement) => a.duration)
  await position(page, duration)
  await expect(page).toHaveURL(new RegExp(praxis + '$'))
})

test('expired or removed saved selection falls back to the newest episode; invalid explicit route stays 404', async ({
  page,
}) => {
  await seed(page, 'wp-removed')
  await page.goto('/')
  await position(page, 0)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('h1')).toHaveText('Ruminate')
  const response = await page.goto('/episodes/missing')
  expect(response?.status()).toBe(404)
  await expect(page.locator('h1')).toHaveText('Episode not found')
})

test('failed saved detail leaves root usable and does not overwrite its resume position', async ({
  page,
}) => {
  await seed(page)
  await page.route('**/api/episodes/trey-turner-praxis', (route) =>
    route.fulfill({ status: 503, json: { statusCode: 503 } }),
  )
  await page.goto('/')
  await expect(
    page.getByText('Saved episode could not be restored.'),
  ).toBeVisible()
  await position(page, 0)
  await expect(page).toHaveURL(/\/$/)
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).episodeId,
      resumeKey,
    ),
  ).toBe('wp-417')
  await page.locator(`a[href="${ruminate}"]`).click()
  await expect(page).toHaveURL(new RegExp(ruminate + '$'))
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).episodeId,
        resumeKey,
      ),
    )
    .toBe('wp-484')
  await position(page, 0)
})

test('new manual navigation supersedes a pending restore and starts the chosen episode paused', async ({
  page,
}) => {
  await seed(page)
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/episodes/trey-turner-praxis', async (route) => {
    await waiting
    await route.continue().catch(() => {})
  })
  try {
    await page.goto('/')
    await hydrated(page)
    await expect(page.locator('.media-status')).toHaveText(
      'Restoring your place…',
    )
    await page.locator(`a[href="${ruminate}"]`).click()
    await expect(page).toHaveURL(new RegExp(ruminate + '$'))
    release()
    await position(page, 0)
    await expect(page.locator('h1')).toHaveText('Ruminate')
  } finally {
    release()
  }
})

test('a second tab can update shared progress without moving the first, and idle closure does not overwrite it', async ({
  page,
  context,
}) => {
  await seed(page)
  await page.goto(praxis)
  await position(page, 0.75)
  const second = await context.newPage()
  await stubArchiveMedia(second)
  await second.goto(ruminate)
  await ready(second)
  await second.locator('audio').evaluate((a: HTMLAudioElement) => {
    a.currentTime = 1.2
  })
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).episodeId,
        resumeKey,
      ),
    )
    .toBe('wp-484')
  await position(page, 0.75)
  await page.close()
  expect(
    await second.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).episodeId,
      resumeKey,
    ),
  ).toBe('wp-484')
})

for (const accepted of [true, false])
  test(`a superseding navigation defers bootstrap and preserves the saved record until it settles (${accepted})`, async ({
    page,
  }) => {
    await seed(page)
    await page.addInitScript(() => {
      const original = HTMLMediaElement.prototype.load
      HTMLMediaElement.prototype.load = function () {
        document.documentElement.dataset.loads = String(
          Number(document.documentElement.dataset.loads ?? 0) + 1,
        )
        return original.call(this)
      }
    })
    let releaseRestore!: () => void
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve
    })
    await page.route('**/api/episodes/trey-turner-praxis', async (route) => {
      await restoreGate
      await route.continue().catch(() => {})
    })
    let releaseManual!: () => void
    let requested!: () => void
    const request = new Promise<void>((resolve) => {
      requested = resolve
    })
    const manualGate = new Promise<void>((resolve) => {
      releaseManual = resolve
    })
    const target = '/episodes/trey-turner-the-dark-prophet'
    await page.route('**/api' + target, async (route) => {
      requested()
      await manualGate
      if (accepted) await route.continue()
      else await route.fulfill({ status: 503, json: { statusCode: 503 } })
    })
    try {
      await page.goto('/')
      await hydrated(page)
      await expect(page.locator('.media-status')).toHaveText(
        'Restoring your place…',
      )
      await page.locator(`a[href="${target}"]`).click()
      await request
      expect(await page.locator('html').getAttribute('data-loads')).toBeNull()
      expect(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).episodeId,
          resumeKey,
        ),
      ).toBe('wp-417')
      releaseRestore()
      releaseManual()
      if (accepted) await expect(page).toHaveURL(new RegExp(target + '$'))
      else
        await expect(
          page.getByText('Saved episode could not be restored.'),
        ).toBeVisible()
      await ready(page)
      expect(await page.locator('html').getAttribute('data-loads')).toBe('1')
      await expect(page.locator('audio')).toHaveJSProperty('paused', true)
      if (!accepted)
        expect(
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key)!).episodeId,
            resumeKey,
          ),
        ).toBe('wp-417')
    } finally {
      releaseRestore()
      releaseManual()
    }
  })
