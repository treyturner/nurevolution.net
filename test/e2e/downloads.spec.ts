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

test('download URLs support native media probes, seeking ranges, and safe full fallbacks', async ({
  request,
}) => {
  const url = `${mediaBaseURL}/downloads/first`
  for (const [range, start, end] of [
    ['bytes=0-1', 0, 1],
    ['bytes=10-99', 10, 99],
    ['bytes=100-', 100, mp3.length - 1],
    ['bytes=-100', mp3.length - 100, mp3.length - 1],
  ] as const) {
    const response = await request.get(url, { headers: { range } })
    expect(response.status()).toBe(206)
    expect(response.headers()['content-range']).toBe(
      `bytes ${start}-${end}/${mp3.length}`,
    )
    expect(response.headers()['content-length']).toBe(String(end - start + 1))
    expect(response.headers()['accept-ranges']).toBe('bytes')
    expect(response.headers()['content-type']).toBe('audio/mpeg')
    expect(await response.body()).toEqual(mp3.subarray(start, end + 1))
  }
  const invalid = await request.get(url, {
    headers: { range: `bytes=${mp3.length}-` },
  })
  expect(invalid.status()).toBe(416)
  expect(invalid.headers()['content-range']).toBe(`bytes */${mp3.length}`)
  const head = await request.head(url, { headers: { range: 'bytes=0-1' } })
  expect(head.status()).toBe(200)
  expect(head.headers()['content-length']).toBe(String(mp3.length))
  expect(head.headers()['accept-ranges']).toBe('bytes')
  const conditional = await request.get(url, {
    headers: { range: 'bytes=0-1', 'if-range': '"old"' },
  })
  expect(conditional.status()).toBe(200)
  expect(await conditional.body()).toEqual(mp3)
})

test('the download URL can load, seek, and play through a native media element', async ({
  page,
}) => {
  await page.goto(`${mediaBaseURL}/player-test`)
  await page.evaluate(() => {
    const audio = document.createElement('audio')
    audio.id = 'download-preview'
    audio.controls = true
    audio.muted = true
    audio.preload = 'auto'
    audio.src = '/downloads/first'
    document.body.append(audio)
    audio.load()
  })
  const audio = page.locator('#download-preview')
  await expect
    .poll(() =>
      audio.evaluate(
        (a: HTMLAudioElement) => Number.isFinite(a.duration) && a.duration > 1,
      ),
    )
    .toBe(true)
  await audio.evaluate((a: HTMLAudioElement) => {
    a.currentTime = 0.5
  })
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.seeking))
    .toBe(false)
  await audio.evaluate((a: HTMLAudioElement) => a.play())
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(0.5)
  expect(await audio.evaluate((a: HTMLAudioElement) => a.error)).toBeNull()
})
