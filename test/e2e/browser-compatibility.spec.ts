import { expect, test } from '@playwright/test'
import { ready, stubArchiveMedia } from './media'

const path = '/episodes/trey-turner-ruminate'

test('production entry works without import maps or newer optional APIs', async ({
  page,
  request,
}) => {
  const response = await request.get(path)
  const html = await response.text()
  expect(html).not.toContain('type="importmap"')
  expect(html).not.toContain('#entry')
  await stubArchiveMedia(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(Array.prototype, 'findLastIndex', {
      value: undefined,
    })
    Object.defineProperty(Array.prototype, 'at', { value: undefined })
    Object.defineProperty(Object, 'hasOwn', { value: undefined })
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      value: undefined,
    })
    Object.defineProperty(window, 'ResizeObserver', { value: undefined })
  })
  await page.goto(path)
  await ready(page)
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.muted = true
    audio.loop = true
  })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('.media-status')).toHaveText(/^Playing\b/)
  await page.getByRole('button', { name: 'Next episode', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal).toHaveClass(/modal-fallback/)
  const cancel = modal.getByRole('button', { name: 'Keep listening' })
  const accept = modal.getByRole('button', {
    name: 'Change episode',
    exact: true,
  })
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(accept).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  await expect(
    page.getByRole('button', { name: 'Next episode', exact: true }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Next episode', exact: true }).click()
  await accept.click()
  await expect(page).not.toHaveURL(new RegExp(path + '$'))
  await ready(page)
  await expect(page.locator('audio')).toHaveJSProperty('paused', false)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 740 })
  await page.evaluate(() => {
    document.documentElement.classList.add('no-flex-gap')
    document.documentElement.style.fontSize = '200%'
    window.dispatchEvent(new Event('resize'))
  })
  await expect(page.locator('.audio-controls')).toHaveClass(/compact-controls/)
  await page.getByRole('tab', { name: 'Tracklist', exact: true }).click()
  await expect(page.locator('.track-list')).toHaveClass(/compact-tracks/)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  for (const size of await page
    .locator('.transport-row button')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().width),
    ))
    expect(size).toBeGreaterThanOrEqual(44)
  expect(errors).toEqual([])
})

test('a missing entry shows bounded startup feedback and recovers when entry arrives late', async ({
  page,
}) => {
  await stubArchiveMedia(page)
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/_nuxt/*.js', async (route) => {
    await held
    await route.continue()
  })
  const watchdogLoaded = page.waitForResponse('**/player-startup.js')
  await page.goto(path, { waitUntil: 'commit' })
  await expect(page.locator('.player-startup-loading')).toHaveText(
    'Loading player…',
  )
  // The classic script is independent of the held module entry.
  await watchdogLoaded
  await page.waitForFunction(() => document.readyState !== 'loading')
  const actions = page.locator('.player-actions')
  const before = await actions.boundingBox()
  await page.clock.fastForward(14999)
  await expect(page.locator('.player-startup-failure')).toBeHidden()
  await page.clock.fastForward(1)
  await expect(page.locator('.player-startup-failure')).toBeVisible()
  await expect(page.locator('.player-startup-loading')).toBeHidden()
  await expect(
    page.getByRole('link', { name: 'Reload', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Download MP3', exact: true }),
  ).toBeVisible()
  expect((await actions.boundingBox())!.height).toBe(before!.height)
  release()
  await ready(page)
  await expect(page.locator('.player-startup-failure')).toHaveCount(0)
  await expect(page.locator('.media-status')).toHaveText(
    'Press Play to listen.',
  )
  await expect(page.locator('audio')).toHaveJSProperty('paused', true)
})

test('without JavaScript the existing status row explains playback and keeps the download', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await stubArchiveMedia(page)
  await page.goto(path)
  await expect(page.locator('.media-status')).toHaveText(
    'JavaScript is needed for playback. You can download the MP3.',
    { useInnerText: true },
  )
  await expect(page.locator('.media-status noscript')).toBeVisible()
  await expect(page.locator('.player-startup-loading')).toBeHidden()
  await expect(page.locator('.player-startup-failure')).toBeHidden()
  await expect(
    page.getByRole('link', { name: 'Download MP3', exact: true }),
  ).toBeVisible()
  await context.close()
})
