import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fulfillAudio, ready, stubArchiveMedia } from './media'

const long = await readFile(
  new URL('../fixtures/media-app/public/long.wav', import.meta.url),
)

const praxis = '/episodes/trey-turner-praxis'
const ruminate = '/episodes/trey-turner-ruminate'
const question = 'Stop playback to change episodes?'
const dialog = (page: Page) => page.getByRole('dialog', { name: question })
const confirm = (page: Page) =>
  page.getByRole('button', { name: 'Change episode', exact: true }).click()

async function fixture(page: Page, playing = true) {
  await stubArchiveMedia(page)
  await page.route('https://podcast.nurevolution.net/**', (route) =>
    fulfillAudio(route, long, 'audio/wav'),
  )
  await page.goto(praxis)
  await ready(page)
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.muted = true
    audio.loop = true
  })
  if (playing) {
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('.media-status')).toHaveText('Playing')
  }
}

test('cancelling an episode change keeps audio playing without a request, source change, or lost focus', async ({
  page,
}) => {
  await fixture(page)
  let requested = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/api' + ruminate)) requested++
  })
  const audio = await page.locator('audio').elementHandle()
  const link = page.locator(`.episode-list a[href="${ruminate}"]`)
  await link.focus()
  await link.press('Enter')
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('Trey Turner - Ruminate')
  await expect(
    page.getByRole('button', { name: 'Keep listening' }),
  ).toBeFocused()
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  expect(requested).toBe(0)
  await expect(page).toHaveURL(new RegExp(praxis + '$'))
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden')
  const bounds = (await dialog(page).boundingBox())!
  await page.mouse.click(bounds.x + 4, bounds.y + 4)
  await expect(dialog(page)).toBeVisible()
  const scrollPosition = await page.evaluate(() => window.scrollY)
  await page.mouse.move(2, 2)
  await page.mouse.wheel(0, 500)
  // Allow the browser to process the wheel gesture before checking the lock.
  await page.waitForTimeout(150)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollPosition)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')
  await expect(link).toBeFocused()
  expect(
    await audio!.evaluate((el) => el === document.querySelector('audio')),
  ).toBe(true)
  await link.click()
  await page.getByRole('button', { name: 'Keep listening' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  expect(requested).toBe(0)
  await page.locator(`.episode-list a[href="${praxis}"]`).click()
  await expect(dialog(page)).toHaveCount(0)
  await link.click()
  await expect(dialog(page)).toBeVisible()
  await page.mouse.click(2, 2)
  await expect(dialog(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Next episode', exact: true }).click()
  await expect(dialog(page)).toBeVisible()
  await page.getByRole('button', { name: 'Keep listening' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await expect(
    page.getByText(
      'Episode could not be loaded. Choose an episode to try again.',
    ),
  ).toHaveCount(0)
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  await expect(
    page.getByRole('button', { name: 'Next episode', exact: true }),
  ).toBeEnabled()
})

test('confirmed switches and history preserve active playback; transport confirmation has no decision timeout', async ({
  page,
}) => {
  await fixture(page)
  await page.locator(`.episode-list a[href="${ruminate}"]`).click()
  await expect(dialog(page)).toBeVisible()
  await confirm(page)
  await expect(page).toHaveURL(new RegExp(ruminate + '$'))
  await ready(page)
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await page.evaluate(() => history.back())
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('Praxis')
  await page.getByRole('button', { name: 'Keep listening' }).click()
  await expect(page).toHaveURL(new RegExp(ruminate + '$'))
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  await page.evaluate(() => history.back())
  await expect(dialog(page)).toBeVisible()
  await confirm(page)
  await expect(page).toHaveURL(new RegExp(praxis + '$'))
  await ready(page)
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await page.getByRole('button', { name: 'Next episode', exact: true }).click()
  await expect(dialog(page)).toBeVisible()
  // The five-second data-request deadline must not time out a human decision.
  await page.waitForTimeout(5500)
  await expect(dialog(page)).toBeVisible()
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  await confirm(page)
  await expect(page).not.toHaveURL(new RegExp(praxis + '$'))
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await expect(
    page.getByText(
      'Episode could not be loaded. Choose an episode to try again.',
    ),
  ).toHaveCount(0)
})

test('paused selections and automatic advancement need no confirmation, and the dialog fits enlarged mobile text', async ({
  page,
}) => {
  await fixture(page, false)
  await page.locator(`.episode-list a[href="${ruminate}"]`).click()
  await expect(page).toHaveURL(new RegExp(ruminate + '$'))
  await expect(dialog(page)).toHaveCount(0)
  await ready(page)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.loop = false
    audio.currentTime = audio.duration - 0.15
  })
  await expect(page).not.toHaveURL(new RegExp(ruminate + '$'))
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.locator('.media-status')).toHaveText('Playing')
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.loop = true
  })
  await page.setViewportSize({ width: 320, height: 720 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await page.getByRole('tab', { name: 'Episodes' }).click()
  await page
    .locator('.episode-list li:not(.selected) > a:first-child')
    .first()
    .click()
  await expect(dialog(page)).toBeVisible()
  expect(
    await dialog(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true)
  await page.getByRole('button', { name: 'Keep listening' }).click()
  await expect(dialog(page)).toHaveCount(0)
})
