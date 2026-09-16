import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { mediaBaseURL } from '../../playwright.config'
import fixture from '../fixtures/playback/fixture.json' with { type: 'json' }

const v = fixture.entry.virtual
const path = `/playback/${fixture.entry.sourceSha256}/${v.sha256}.m4a`

test('the real player uses qualified media and recovers from an unavailable virtual source', async ({
  page,
  browserName,
}) => {
  for (const failure of [false, true]) {
    let failedRequests = 0
    page.on('request', (request) => {
      if (request.url().endsWith('/playback/unavailable.m4a')) failedRequests++
    })
    await page.goto(
      mediaBaseURL + '/virtual-player' + (failure ? '?fail=1' : ''),
    )
    const audio = page.locator('audio')
    await expect
      .poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState))
      .toBeGreaterThanOrEqual(1)
    await expect(audio).toHaveJSProperty('paused', true)
    await expect(audio).toHaveJSProperty(
      'src',
      mediaBaseURL +
        (browserName === 'chromium' && !failure ? path : '/virtual-source.mp3'),
    )
    // Headless Firefox needs muted output when the runner has no audio device.
    await audio.evaluate((element: HTMLAudioElement) => {
      element.muted = true
    })
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(audio).toHaveJSProperty('paused', false)
    await expect
      .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
      .toBeGreaterThan(0.1)
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(audio).toHaveJSProperty('paused', true)
    if (failure) expect(failedRequests).toBe(browserName === 'chromium' ? 1 : 0)
    page.removeAllListeners('request')
  }
})

test('serves the reference MP4 exactly, including ranges across its virtual boundary', async ({
  request,
}) => {
  const source = await readFile('test/fixtures/playback/seek.mp3')
  const header = gunzipSync(
    await readFile(`test/fixtures/playback/headers/${v.sha256}.gz`),
  )
  const reference = Buffer.concat([
    header,
    source.subarray(v.audioOffset, v.audioOffset + v.audioByteLength),
  ])
  expect(createHash('sha256').update(reference).digest('hex')).toBe(v.sha256)
  const url = mediaBaseURL + path
  expect(await (await request.get(url)).body()).toEqual(reference)
  const head = await request.head(url)
  expect(head.headers()['content-type']).toBe('audio/mp4')
  expect(head.headers()['content-length']).toBe(String(reference.length))
  for (const [start, end] of [
    [0, 1],
    [header.length - 7, header.length + 7],
    [reference.length - 7, reference.length - 1],
  ]) {
    const r = await request.get(url, {
      headers: { Range: `bytes=${start}-${end}` },
    })
    expect(r.status()).toBe(206)
    expect(await r.body()).toEqual(reference.subarray(start, end! + 1))
  }
  expect(
    (
      await request.get(url, {
        headers: { 'If-None-Match': head.headers().etag! },
      })
    ).status(),
  ).toBe(304)
  expect(
    (
      await request.get(url, {
        headers: { Range: `bytes=${reference.length}-` },
      })
    ).status(),
  ).toBe(416)
})

test('Chromium seeks to the actual audio content, not only the requested clock time', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Other engines deliberately use the MP3 fallback',
  )
  await page.goto(mediaBaseURL + '/media-test')
  const result = await page.evaluate(
    async ({ path }) => {
      const context = new AudioContext({ sampleRate: 44100 })
      const reference = await context.decodeAudioData(
        await (await fetch('/virtual-source.mp3')).arrayBuffer(),
      )
      const audio = new Audio(path)
      await new Promise<void>((resolve, reject) => {
        audio.onloadedmetadata = () => resolve()
        audio.onerror = () => reject(Error('Virtual media failed to load'))
      })
      const source = context.createMediaElementSource(audio)
      const capture = context.createScriptProcessor(2048, 2, 2)
      source.connect(capture)
      capture.connect(context.destination)
      await context.resume()
      function envelope(input: Float32Array) {
        const size = 128,
          result = new Float64Array(Math.floor(input.length / size))
        for (let i = 0; i < result.length; i++) {
          let sum = 0
          for (let k = 0; k < size; k++) sum += input[i * size + k]! ** 2
          result[i] = Math.sqrt(sum / size)
        }
        return result
      }
      const ref = envelope(reference.getChannelData(0))
      const errors: number[] = []
      for (const target of [13.37, 3.28, 18.42, 3.28]) {
        audio.currentTime = target
        await new Promise<void>((resolve) =>
          audio.addEventListener('seeked', () => resolve(), { once: true }),
        )
        const chunks: Float32Array[] = []
        let firstTime = 0
        const done = new Promise<void>((resolve) => {
          capture.onaudioprocess = (event) => {
            const samples = event.inputBuffer.getChannelData(0)
            if (
              !chunks.length &&
              !samples.some((value) => Math.abs(value) > 0.00001)
            )
              return
            if (!chunks.length) firstTime = audio.currentTime
            chunks.push(Float32Array.from(samples))
            if (chunks.length === 20) {
              capture.onaudioprocess = null
              audio.pause()
              resolve()
            }
          }
        })
        await audio.play()
        await done
        const samples = new Float32Array(chunks.length * 2048)
        chunks.forEach((chunk, i) => samples.set(chunk, i * 2048))
        const actual = envelope(samples),
          skip = 87,
          length = actual.length - skip
        let score = -Infinity,
          best = 0
        let sy = 0,
          sy2 = 0
        for (let j = 0; j < length; j++) {
          sy += actual[skip + j]!
          sy2 += actual[skip + j]! ** 2
        }
        for (let i = 0; i < ref.length - length; i++) {
          let sx = 0,
            sx2 = 0,
            sxy = 0
          for (let j = 0; j < length; j++) {
            const x = ref[i + j]!,
              y = actual[skip + j]!
            sx += x
            sx2 += x * x
            sxy += x * y
          }
          const candidate =
            (length * sxy - sx * sy) /
            Math.sqrt((length * sx2 - sx * sx) * (length * sy2 - sy * sy))
          if (candidate > score) {
            score = candidate
            best = i
          }
        }
        if (score < 0.8) throw Error(`Unreliable audio comparison: ${score}`)
        errors.push(((best - skip) * 128) / 44100 - firstTime)
      }
      audio.pause()
      source.disconnect()
      capture.disconnect()
      await context.close()
      return { errors, duration: audio.duration }
    },
    { path },
  )
  expect(result.duration).toBeCloseTo(v.samples / v.sampleRate, 5)
  for (const error of result.errors) expect(Math.abs(error)).toBeLessThan(0.1)
})
