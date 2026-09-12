import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mediaBaseURL } from '../../playwright.config'
import { mp3, ready } from './media'

test('browser saves attachment bytes and punctuation without disturbing playback', async ({
  page,
}) => {
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.url()))
  await page.goto(`${mediaBaseURL}/player-test`)
  await ready(page)
  for (const [button, filename] of [
    ['Select first', 'test-tone.mp3'],
    ['Select second', "bouche_d'incendie.mp3"],
  ]) {
    await page.getByRole('button', { name: button, exact: true }).click()
    await ready(page)
    const before = await page
      .locator('audio')
      .evaluate((a: HTMLAudioElement) => ({
        src: a.src,
        paused: a.paused,
        time: a.currentTime,
      }))
    const slug = button === 'Select first' ? 'first' : 'second'
    for (const link of [
      page.getByRole('link', { name: 'Download MP3' }),
      page.locator(`.row-download[href="/downloads/${slug}"]`),
    ]) {
      const count = downloads.length
      const downloadPromise = page.waitForEvent('download')
      await link.click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toBe(filename)
      expect(await download.failure()).toBeNull()
      expect(await readFile((await download.path())!)).toEqual(mp3)
      expect(downloads).toHaveLength(count + 1)
    }
    expect(
      await page.locator('audio').evaluate((a: HTMLAudioElement) => ({
        src: a.src,
        paused: a.paused,
        time: a.currentTime,
      })),
    ).toEqual(before)
  }
  await page.locator('audio').evaluate((a: HTMLAudioElement) => {
    a.muted = true
    a.loop = true
  })
  await page.getByRole('button', { name: 'Play fixture' }).click()
  const playingDownload = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download MP3' }).click()
  expect(await (await playingDownload).failure()).toBeNull()
  expect(
    await page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused),
  ).toBe(false)
})

test('built attachment handler implements HEAD, method rejection, and unknown files', async ({
  request,
}) => {
  const head = await request.head(`${mediaBaseURL}/downloads/second`)
  expect(head.status()).toBe(200)
  expect(head.headers()['content-length']).toBe(String(mp3.length))
  expect(head.headers()['content-disposition']).toContain(
    'bouche_d%27incendie.mp3',
  )
  expect((await head.body()).length).toBe(0)
  expect((await request.post(`${mediaBaseURL}/downloads/first`)).status()).toBe(
    405,
  )
  expect((await request.get('/downloads/unknown')).status()).toBe(404)
})
