import { expect, test } from '@playwright/test'
import { ready, stubArchiveMedia } from './media'

test.use({
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/152.0.0.0 Mobile Safari/537.36',
})

test('Android copy actions avoid duplicate success popups and keep visible errors', async ({
  page,
  browserName,
}) => {
  await stubArchiveMedia(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (value: string) => {
          document.documentElement.dataset.copied = value
        },
      },
      configurable: true,
    })
  })
  await page.goto('/episodes/trey-turner-ruminate')
  await ready(page)
  for (const selector of [
    '.timestamp-copy',
    '.row-copy-link',
    '.rss-link',
    '[role="menuitem"]',
  ]) {
    if (selector === '[role="menuitem"]')
      await page
        .getByRole('slider', { name: 'Playback position' })
        .press('Shift+F10')
    await page.evaluate(() => {
      delete document.documentElement.dataset.copied
    })
    await page.locator(selector).first().tap()
    await expect(page.locator('html')).toHaveAttribute(
      'data-copied',
      /^https?:/,
    )
    await expect(page.locator('.copy-link-toast')).toHaveCount(0)
  }
  const trackCopy = page.locator('.timestamp-copy').first()
  if (browserName !== 'firefox')
    await expect(trackCopy).toHaveCSS(
      '-webkit-tap-highlight-color',
      'rgba(0, 0, 0, 0)',
    )
  await trackCopy.tap()
  await expect(trackCopy).toHaveCSS('outline-style', 'none')
  await trackCopy.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(trackCopy).toBeFocused()
  await expect(trackCopy).toHaveCSS('outline-style', 'solid')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new DOMException('Denied', 'NotAllowedError')
        },
      },
    })
  })
  await trackCopy.tap()
  await expect(page.locator('.copy-link-toast')).toHaveText(
    'Couldn’t copy link. Please try again.',
  )
})
