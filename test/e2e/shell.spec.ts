import { expect, test } from '@playwright/test'
import { stubArchiveMedia } from './media'
test.beforeEach(async ({ page }) => stubArchiveMedia(page))

test('serves meaningful HTML before JavaScript runs', async ({ request }) => {
  const response = await request.get('/')
  expect(response.status()).toBe(200)
  const html = await response.text()
  expect(html).toMatch(/<html[^>]*lang="en"/)
  expect(html).toContain('<title>nurevolution studios</title>')
  expect(html).toMatch(/<meta[^>]*name="color-scheme"[^>]*content="dark"/)
  expect(html).toMatch(
    /<main[^>]*>[\s\S]*<h1[^>]*>Ruminate<\/h1>[\s\S]*<\/main>/,
  )
})

test('hydrates a dark shell with no application errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /hydration.*mismatch/i.test(message.text())
    ) {
      errors.push(message.text())
    }
  })
  page.on('requestfailed', (request) => errors.push(request.url()))
  page.on('response', (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`)
  })
  await page.goto('/')
  // Observe the mounted Nuxt app without adding a production test hook.
  await page.waitForFunction(() => {
    const root = document.getElementById('__nuxt') as
      | (HTMLElement & {
          __vue_app__?: { $nuxt?: { isHydrating: boolean } }
        })
      | null
    return root?.__vue_app__?.$nuxt?.isHydrating === false
  })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ruminate')
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(16, 18, 22)',
  )
  await expect(page.locator('audio')).toHaveCount(1)
  await expect(page).toHaveTitle('nurevolution studios')
  expect(errors).toEqual([])
})

test('supports keyboard access and narrow screens with enlarged text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await expect(skip).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'))
  await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('returns real 404s and keeps media fixtures out of production', async ({
  request,
}) => {
  for (const path of [
    '/does-not-exist',
    '/media-test',
    '/player-test',
    '/sample.wav',
    '/sample.mp3',
    '/media/sample.wav',
    '/media/sample.mp3',
    '/cover.svg',
  ]) {
    const response = await request.get(path)
    expect(response.status(), path).toBe(404)
  }
})
