import { expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
export const mp3 = await readFile(
  new URL('../fixtures/media-app/public/sample.mp3', import.meta.url),
)
const cover = await readFile(
  new URL('../fixtures/media-app/public/cover.svg', import.meta.url),
)
export async function stubArchiveMedia(page: Page) {
  await page.route('https://podcast.nurevolution.net/**', (route) =>
    route.fulfill({ body: mp3, contentType: 'audio/mpeg' }),
  )
  await page.route('https://nurevolution.net/wp/**', (route) =>
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
