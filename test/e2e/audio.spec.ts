import { expect, test } from '@playwright/test'
import { mediaBaseURL } from '../../playwright.config'

test.use({ baseURL: mediaBaseURL })

test('loads paused, plays on a user action, pauses, and reaches the end', async ({
  page,
}) => {
  await page.goto('/media-test')
  const status = page.getByRole('status', { name: 'Playback state' })
  const audio = page.locator('audio')
  await expect(status).toHaveText('Ready')
  await expect(audio).toHaveJSProperty('paused', true)
  await expect(audio).toHaveJSProperty('currentTime', 0)
  await expect(audio).toHaveJSProperty('duration', 2)

  const play = page.getByRole('button', { name: 'Play', exact: true })
  await play.focus()
  await expect(play).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Space')
  await expect(status).toHaveText('Playing')
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(status).toHaveText('Paused')
  await expect(audio).toHaveJSProperty('paused', true)

  await play.click()
  await expect(status).toHaveText('Ended')
  await expect(audio).toHaveJSProperty('ended', true)
  await expect(audio).toHaveJSProperty('paused', true)
  await expect(page.getByRole('alert')).toHaveCount(0)

  await page.reload()
  await expect(status).toHaveText('Ready')
  await expect(audio).toHaveJSProperty('paused', true)
  await expect(audio).toHaveJSProperty('currentTime', 0)
})

test('disposal pauses the native media element and detaches status listeners', async ({
  page,
}) => {
  await page.goto('/media-test')
  await expect(page.getByRole('status', { name: 'Playback state' })).toHaveText(
    'Ready',
  )
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Playback state' })).toHaveText(
    'Playing',
  )
  await page.getByRole('button', { name: 'Dispose player' }).click()
  await expect(page.locator('audio')).toHaveJSProperty('paused', true)
  await expect(page.getByRole('status', { name: 'Playback state' })).toHaveText(
    'Disposed',
  )
  await page.locator('audio').dispatchEvent('ended')
  await expect(page.getByRole('status', { name: 'Playback state' })).toHaveText(
    'Disposed',
  )
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeDisabled()
})
