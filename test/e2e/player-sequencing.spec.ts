import { expect, test, type Page } from '@playwright/test'
import type { EpisodeSummary } from '../../shared/content/public'
import { ready, stubArchiveMedia } from './media'
async function fixture(page: Page, single = false) {
  const response = await page.request.get('/api/episodes')
  const all: EpisodeSummary[] = (await response.json()).episodes
  const episodes = single ? [all[1]!] : all.slice(0, 3)
  await stubArchiveMedia(page)
  await page.route('**/api/episodes', (route) =>
    route.fulfill({ json: { episodes } }),
  )
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play
    const load = HTMLMediaElement.prototype.load
    HTMLMediaElement.prototype.play = function () {
      document.documentElement.dataset.playCalls = String(
        Number(document.documentElement.dataset.playCalls ?? 0) + 1,
      )
      return play.call(this)
    }
    HTMLMediaElement.prototype.load = function () {
      document.documentElement.dataset.loads = String(
        Number(document.documentElement.dataset.loads ?? 0) + 1,
      )
      return load.call(this)
    }
  })
  await page.goto('/')
  await ready(page)
  await page.locator(`a[href="${all[1]!.path}"]`).click()
  await expect(page).toHaveURL(new RegExp(all[1]!.path + '$'))
  await ready(page)
  await page.locator('audio').evaluate((a: HTMLAudioElement) => {
    a.muted = true
  })
  return episodes
}
async function play(page: Page) {
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('.media-status')).toHaveText('Playing')
}
async function pause(page: Page) {
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.locator('audio')).toHaveJSProperty('paused', true)
}
async function finish(page: Page) {
  await page.locator('audio').evaluate((a: HTMLAudioElement) => {
    a.currentTime = a.duration - 0.15
  })
}
async function hold(page: Page, slug: string) {
  let release!: () => void
  let requested!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const request = new Promise<void>((resolve) => {
    requested = resolve
  })
  await page.route(`**/api/episodes/${slug}`, async (route) => {
    requested()
    await waiting
    await route.continue().catch(() => {})
  })
  return { release, request }
}
test('manual older/newer wrap independently of automatic order and use ordinary history', async ({
  page,
}) => {
  const episodes = await fixture(page)
  const history = await page.evaluate(() => window.history.length)
  await page
    .getByRole('combobox', { name: 'Automatic playback order' })
    .selectOption('newer')
  for (const index of [2, 0]) {
    await page.getByRole('button', { name: 'Older episode' }).click()
    await expect(page).toHaveURL(new RegExp(episodes[index]!.path + '$'))
    await ready(page)
    await expect(page.locator('audio')).toHaveJSProperty('paused', true)
  }
  await page.getByRole('button', { name: 'Newer episode' }).click()
  await expect(page).toHaveURL(new RegExp(episodes[2]!.path + '$'))
  expect(await page.evaluate(() => window.history.length)).toBe(history + 3)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(episodes[0]!.path + '$'))
  await expect(page.locator('audio')).toHaveCount(1)
})
test('actual natural completion advances in both directions and replaces history', async ({
  page,
}) => {
  const episodes = await fixture(page)
  const history = await page.evaluate(() => window.history.length)
  await play(page)
  await expect(page).toHaveURL(new RegExp(episodes[2]!.path + '$'))
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await pause(page)
  expect(await page.evaluate(() => window.history.length)).toBe(history)
  await page
    .getByRole('combobox', { name: 'Automatic playback order' })
    .selectOption('newer')
  await play(page)
  await expect(page).toHaveURL(new RegExp(episodes[1]!.path + '$'))
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await pause(page)
  expect(await page.evaluate(() => window.history.length)).toBe(history)
  await expect(page.locator('audio')).toHaveCount(1)
})
test('paused seeks to the end never arm automatic progression', async ({
  page,
}) => {
  const episodes = await fixture(page)
  await page.getByRole('slider', { name: 'Playback position' }).press('End')
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((a: HTMLAudioElement) => a.currentTime === a.duration),
    )
    .toBe(true)
  await expect(page).toHaveURL(new RegExp(episodes[1]!.path + '$'))
  expect(await page.locator('html').getAttribute('data-play-calls')).toBeNull()
})
test('Pause while the next detail is pending allows its commit but cancels continuation', async ({
  page,
}) => {
  const episodes = await fixture(page)
  const held = await hold(page, episodes[2]!.slug)
  try {
    await play(page)
    await finish(page)
    await held.request
    await expect(
      page.getByRole('group', { name: 'Episode navigation' }),
    ).toHaveAttribute('aria-busy', 'true')
    await pause(page)
    held.release()
    await expect(page).toHaveURL(new RegExp(episodes[2]!.path + '$'))
    await ready(page)
    await expect(page.locator('audio')).toHaveJSProperty('paused', true)
    expect(await page.locator('html').getAttribute('data-play-calls')).toBe('1')
  } finally {
    held.release()
  }
})
test('a manual selection supersedes pending automatic navigation without a stale continuation', async ({
  page,
}) => {
  const episodes = await fixture(page)
  const held = await hold(page, episodes[2]!.slug)
  try {
    await play(page)
    await finish(page)
    await held.request
    await page.locator(`a[href="${episodes[0]!.path}"]`).click()
    await expect(page).toHaveURL(new RegExp(episodes[0]!.path + '$'))
    held.release()
    await ready(page)
    await expect(page.locator('audio')).toHaveJSProperty('paused', true)
    expect(await page.locator('html').getAttribute('data-play-calls')).toBe('1')
  } finally {
    held.release()
  }
})
test('an already pending manual request wins over a natural end', async ({
  page,
}) => {
  const episodes = await fixture(page)
  const held = await hold(page, episodes[0]!.slug)
  try {
    await play(page)
    await page.locator(`a[href="${episodes[0]!.path}"]`).click()
    await held.request
    await finish(page)
    await expect(page.locator('.media-status')).toHaveText('Episode finished.')
    held.release()
    await expect(page).toHaveURL(new RegExp(episodes[0]!.path + '$'))
    await ready(page)
    await expect(page.locator('audio')).toHaveJSProperty('paused', true)
  } finally {
    held.release()
  }
})
test('a failed automatic target stops without a retry loop and leaves manual recovery available', async ({
  page,
}) => {
  const episodes = await fixture(page)
  let requests = 0
  await page.route(`**/api/episodes/${episodes[2]!.slug}`, (route) => {
    requests++
    return route.fulfill({ status: 404, json: { statusCode: 404 } })
  })
  await play(page)
  await finish(page)
  await expect(
    page.getByText(
      'Episode could not be loaded. Choose an episode to try again.',
    ),
  ).toBeVisible()
  await expect(page).toHaveURL(new RegExp(episodes[1]!.path + '$'))
  await expect(page.locator('.media-status')).toHaveText('Episode finished.')
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeEnabled()
  expect(requests).toBe(1)
})
test('one episode restarts without source loads or route changes, manually and after natural completion', async ({
  page,
}) => {
  const episodes = await fixture(page, true)
  const loads = await page.locator('html').getAttribute('data-loads')
  await page
    .getByRole('slider', { name: 'Playback position' })
    .press('ArrowRight')
  await page.getByRole('button', { name: 'Older episode' }).click()
  await expect
    .poll(() =>
      page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBe(0)
  await play(page)
  await expect
    .poll(() => page.locator('html').getAttribute('data-play-calls'))
    .toBe('2')
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await pause(page)
  await expect(page).toHaveURL(new RegExp(episodes[0]!.path + '$'))
  expect(await page.locator('html').getAttribute('data-loads')).toBe(loads)
})
test('a rejected automatic Play stops on the new episode with an explicit continuation prompt', async ({
  page,
}) => {
  const episodes = await fixture(page)
  await page.evaluate(() => {
    const original = HTMLMediaElement.prototype.play
    let calls = 0
    HTMLMediaElement.prototype.play = function () {
      if (++calls > 1)
        return Promise.reject(new DOMException('blocked', 'NotAllowedError'))
      return original.call(this)
    }
  })
  await play(page)
  await finish(page)
  await expect(page).toHaveURL(new RegExp(episodes[2]!.path + '$'))
  await expect(page.locator('.media-status')).toHaveText(
    'Press Play to continue.',
  )
  await expect(page.locator('audio')).toHaveJSProperty('paused', true)
})
