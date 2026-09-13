import { expect, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
export const mp3 = await readFile(
  new URL('../fixtures/media-app/public/sample.mp3', import.meta.url),
)
const cover = await readFile(
  new URL('../fixtures/media-app/public/cover.svg', import.meta.url),
)
export async function fulfillAudio(
  route: Route,
  bytes = mp3,
  type = 'audio/mpeg',
) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(
    route.request().headers().range ?? '',
  )
  const start = match ? Number(match[1]) : 0
  const end = match?.[2]
    ? Math.min(Number(match[2]), bytes.length - 1)
    : bytes.length - 1
  const partial = Boolean(match)
  await route.fulfill({
    status: start > end ? 416 : partial ? 206 : 200,
    headers: {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(start > end ? 0 : end - start + 1),
      ...(start > end
        ? { 'Content-Range': `bytes */${bytes.length}` }
        : partial
          ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` }
          : {}),
    },
    body: start > end ? Buffer.alloc(0) : bytes.subarray(start, end + 1),
  })
}
export async function stubArchiveMedia(
  page: Page,
  origins = {
    web: 'https://nurevolution.net',
    media: 'https://podcast.nurevolution.net',
  },
) {
  await page.route(origins.media + '/**', (route) => fulfillAudio(route))
  await page.route(origins.web + '/wp/**', (route) =>
    route.fulfill({ body: cover, contentType: 'image/svg+xml' }),
  )
}
export async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('__nuxt') as
      | (HTMLElement & { __vue_app__?: { $nuxt?: { isHydrating: boolean } } })
      | null
    return root?.__vue_app__?.$nuxt?.isHydrating === false
  })
}
export async function ready(page: Page) {
  await hydrated(page)
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.readyState),
    )
    .toBeGreaterThanOrEqual(1)
}
