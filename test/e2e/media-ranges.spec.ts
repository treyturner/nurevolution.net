import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { mediaBaseURL } from '../../playwright.config'

test('fixture media serves exact full, partial, suffix, and unsatisfiable responses', async ({
  request,
}) => {
  for (const name of ['sample.wav', 'sample.mp3']) {
    const bytes = await readFile(
      new URL(`../fixtures/media-app/public/${name}`, import.meta.url),
    )
    const url = `${mediaBaseURL}/media/${name}`
    const full = await request.get(url)
    expect(full.status()).toBe(200)
    expect(full.headers()['accept-ranges']).toBe('bytes')
    expect(full.headers()['content-type']).toBe(
      name.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg',
    )
    expect(await full.body()).toEqual(bytes)
    for (const [range, start, end] of [
      ['bytes=44-', 44, bytes.length - 1],
      ['bytes=0-43', 0, 43],
      ['bytes=-44', bytes.length - 44, bytes.length - 1],
      ['bytes=44-999999', 44, bytes.length - 1],
    ] as const) {
      const partial = await request.get(url, { headers: { Range: range } })
      expect(partial.status()).toBe(206)
      expect(partial.headers()['content-range']).toBe(
        `bytes ${start}-${end}/${bytes.length}`,
      )
      expect(partial.headers()['content-length']).toBe(String(end - start + 1))
      expect(await partial.body()).toEqual(bytes.subarray(start, end + 1))
    }
    for (const range of [`bytes=${bytes.length}-`, 'bytes=44-0', 'bytes=-0']) {
      const invalid = await request.get(url, { headers: { Range: range } })
      expect(invalid.status()).toBe(416)
      expect(invalid.headers()['content-range']).toBe(`bytes */${bytes.length}`)
      expect(await invalid.body()).toHaveLength(0)
    }
    for (const range of ['bytes=0-1,4-5', 'invalid', 'bytes=-'])
      expect(
        (await request.get(url, { headers: { Range: range } })).status(),
      ).toBe(200)
    expect(
      (
        await request.get(url, {
          headers: { Range: 'bytes=44-', 'If-Range': '"old"' },
        })
      ).status(),
    ).toBe(200)
    const head = await request.head(url, { headers: { Range: 'bytes=44-' } })
    expect(head.status()).toBe(200)
    expect(head.headers()['content-length']).toBe(String(bytes.length))
    expect(await head.body()).toHaveLength(0)
    expect((await request.post(url)).status()).toBe(405)
  }
  expect(
    (await request.get(`${mediaBaseURL}/media/missing.wav`)).status(),
  ).toBe(404)
})

test('fixture reports native media error details', async ({ page }) => {
  await page.route('**/media/sample.wav', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: 'invalid audio',
    }),
  )
  await page.goto(`${mediaBaseURL}/media-test`)
  await expect(page.getByRole('status', { name: 'Playback state' })).toHaveText(
    'Error',
  )
  await expect(page.getByRole('alert')).toContainText('"code":')
  await expect(page.getByRole('alert')).toContainText('"readyState":')
})
