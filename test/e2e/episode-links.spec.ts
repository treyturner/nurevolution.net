import { expect, test } from '@playwright/test'
import { ready, stubArchiveMedia } from './media'

test.beforeEach(async ({ page }) => {
  await stubArchiveMedia(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copiedUrl = text
        },
      },
    })
  })
})

test('keyboard copying preserves the selected player and shows temporary feedback beside the button', async ({
  page,
}) => {
  await page.goto('/episodes/fracture-broken')
  await ready(page)
  const path = page.url()
  const audio = await page.locator('audio').getAttribute('src')
  const row = page.locator('.episode-list li').first()
  const episodePath = await row.locator('a').first().getAttribute('href')
  const button = row.getByRole('button', { name: /^Copy link to/ })
  await button.focus()
  await page.keyboard.press('Enter')
  const toast = page.locator('.copy-link-toast')
  await expect(toast).toHaveText('Episode link copied')
  await expect(page.locator('html')).toHaveAttribute(
    'data-copied-url',
    `https://nurevolution.net${episodePath}`,
  )
  await expect(button).toBeFocused()
  expect(page.url()).toBe(path)
  await expect(page.locator('audio')).toHaveAttribute('src', audio!)
  const buttonBox = (await button.boundingBox())!
  const toastBox = (await toast.boundingBox())!
  expect(Math.abs(toastBox.y + toastBox.height + 8 - buttonBox.y)).toBeLessThan(
    1,
  )
  const linkIcon = (await button.locator('svg').boundingBox())!
  const downloadIcon = (await row.locator('.row-download svg').boundingBox())!
  expect(linkIcon.height).toBeLessThanOrEqual(downloadIcon.height)
  expect(
    Math.abs(
      linkIcon.y +
        linkIcon.height / 2 -
        downloadIcon.y -
        downloadIcon.height / 2,
    ),
  ).toBeLessThan(1)
  await expect(toast).toBeHidden({ timeout: 6000 })
})

test('keeps feedback inside a narrow viewport and falls back to top center after its button scrolls away', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/episodes/fracture-broken')
  await ready(page)
  const button = page.locator('.row-copy-link').first()
  await button.click()
  const toast = page.locator('.copy-link-toast')
  await expect(toast).toBeVisible()
  let box = (await toast.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(12)
  expect(box.x + box.width).toBeLessThanOrEqual(308)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(toast).toHaveCSS('top', '12px')
  box = (await toast.boundingBox())!
  expect(Math.abs(box.x + box.width / 2 - 160)).toBeLessThan(1)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
