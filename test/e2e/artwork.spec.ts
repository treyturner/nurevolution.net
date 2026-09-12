import { expect, test } from '@playwright/test'
import { ready, stubArchiveMedia } from './media'

test.beforeEach(async ({ page }) => stubArchiveMedia(page))

test('keeps smaller artwork at its original size with modal focus and all three close actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await ready(page)
  const trigger = page.getByRole('button', { name: /^Enlarge / })
  const original = await trigger.locator('img').getAttribute('src')
  for (const dismiss of ['escape', 'outside', 'button']) {
    await trigger.focus()
    await page.keyboard.press('Enter')
    const modal = page.getByRole('dialog')
    const close = modal.getByRole('button', { name: 'Close artwork' })
    await expect(modal).toBeVisible()
    await expect(close).toBeFocused()
    await expect(modal.locator('img')).toHaveAttribute('src', original!)
    await expect
      .poll(() =>
        modal.locator('img').evaluate((img: HTMLImageElement) => ({
          natural: [img.naturalWidth, img.naturalHeight],
          rendered: [img.clientWidth, img.clientHeight],
        })),
      )
      .toEqual({ natural: [480, 480], rendered: [480, 480] })
    await page
      .locator('.wordmark')
      .evaluate((link: HTMLElement) => link.focus())
    await expect(close).toBeFocused()
    await modal.locator('img').click()
    await expect(modal).toBeVisible()
    if (dismiss === 'escape') await page.keyboard.press('Escape')
    else if (dismiss === 'outside') await page.mouse.click(10, 10)
    else await close.click()
    await expect(modal).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')
  }
})

test('large originals fit within the viewport with a clickable margin after resizing', async ({
  page,
}) => {
  await page.route('https://nurevolution.net/wp/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1100"><rect width="1400" height="1100" fill="#1c2533"/></svg>',
    }),
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: /^Enlarge / }).click()
  const modal = page.getByRole('dialog')
  const close = modal.getByRole('button', { name: 'Close artwork' })
  await expect
    .poll(() =>
      modal
        .locator('img')
        .evaluate((img: HTMLImageElement) => [
          img.naturalWidth,
          img.naturalHeight,
        ]),
    )
    .toEqual([1400, 1100])
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden')
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await expect
      .poll(() =>
        modal.locator('img').evaluate((img) => {
          const rect = img.getBoundingClientRect()
          return (
            rect.width <= innerWidth * 0.9 + 1 &&
            rect.height <= innerHeight * 0.9 + 1 &&
            rect.left >= innerWidth * 0.05 - 1 &&
            rect.top >= innerHeight * 0.05 - 1 &&
            Math.abs(rect.width / rect.height - 1400 / 1100) < 0.01
          )
        }),
      )
      .toBe(true)
    expect(
      await modal.evaluate((dialog) => ({
        horizontal: dialog.scrollWidth > dialog.clientWidth,
        vertical: dialog.scrollHeight > dialog.clientHeight,
      })),
    ).toEqual({ horizontal: false, vertical: false })
    await expect(close).toBeInViewport()
  }
  await page.mouse.click(10, 10)
  await expect(modal).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')
})

test('keeps playback intact and closes obsolete artwork when history changes episodes', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  await page
    .locator('.episode-list a[href="/episodes/trey-turner-praxis"]')
    .click()
  await ready(page)
  const audio = await page.locator('audio').elementHandle()
  await audio!.evaluate(async (element: HTMLAudioElement) => {
    element.muted = true
    element.loop = true
    await element.play()
  })
  await page.getByRole('button', { name: /^Enlarge / }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(
    await audio!.evaluate((element: HTMLAudioElement) => element.paused),
  ).toBe(false)
  await page.goBack()
  await expect(page.locator('h1')).toHaveText('Ruminate')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await ready(page)
  expect(
    await audio!.evaluate(
      (element) =>
        element.isConnected && element === document.querySelector('audio'),
    ),
  ).toBe(true)
  expect(
    await audio!.evaluate((element: HTMLAudioElement) => element.paused),
  ).toBe(false)
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')
})
