import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { mediaBaseURL } from '../../playwright.config'
import { correlateWaveform } from './helpers/waveform'
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

test('waveform comparison distinguishes identical loudness patterns and reports wrong positions', async ({
  page,
}) => {
  await page.goto(mediaBaseURL + '/media-test')
  await page.addScriptTag({
    content: `window.correlateWaveform = ${correlateWaveform.toString()}`,
  })
  const matches = await page.evaluate(async () => {
    const rate = 8000
    // Each second has exactly the same RMS envelope but different PCM signs.
    let seed = 12345
    const reference = Float32Array.from({ length: rate * 4 }, (_, i) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const amplitude = 0.1 + 0.05 * Math.sin(Math.floor((i % rate) / 128))
      return (seed & 0x80000000 ? 1 : -1) * amplitude
    })
    const matches = []
    for (const start of [0, 12345, reference.length - rate]) {
      const captured = reference
        .slice(start, start + rate)
        .map((value) => value * 0.7 + 0.02)
      captured.fill(0, 0, 500)
      matches.push({
        expected: start / rate,
        ...(await window.correlateWaveform(reference, captured, rate)),
      })
    }
    return matches
  })
  for (const match of matches) {
    expect(match.correlation).toBeGreaterThan(0.999)
    expect(match.offset).toBeCloseTo(match.expected, 5)
  }
  // Matching never receives the requested position and must expose this error.
  expect(Math.abs(matches[1]!.offset - 0.25)).toBeGreaterThan(0.1)
})

test('Chromium seeks to the actual audio content, not only the requested clock time', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium',
    'Other engines deliberately use the MP3 fallback',
  )
  await page.goto(mediaBaseURL + '/media-test')
  await page.addScriptTag({
    content: `window.correlateWaveform = ${correlateWaveform.toString()}`,
  })
  const result = await page.evaluate(
    async ({ path }) => {
      const context = new AudioContext({ sampleRate: 44100 })
      const audio = new Audio(path)
      const source = context.createMediaElementSource(audio)
      try {
        const reference = await context.decodeAudioData(
          await (await fetch('/virtual-source.mp3')).arrayBuffer(),
        )
        if (audio.readyState < 1)
          await new Promise<void>((resolve, reject) => {
            audio.onloadedmetadata = () => resolve()
            audio.onerror = () => reject(Error('Virtual media failed to load'))
          })
        // Keep capture and its starting clock on the audio thread. A delayed
        // main-thread callback must not drop samples or timestamp an old block.
        const module = URL.createObjectURL(
          new Blob(
            [
              `
        class Capture extends AudioWorkletProcessor {
          constructor() {
            super()
            this.samples = new Float32Array(40960)
            this.used = 0
            this.start = null
          }
          process(inputs) {
            const input = inputs[0]?.[0]
            if (!input || this.used === this.samples.length) return true
            if (this.start === null) {
              if (!input.some(value => Math.abs(value) > 0.00001)) return true
              this.start = currentTime
            }
            const count = Math.min(input.length, this.samples.length - this.used)
            this.samples.set(input.subarray(0, count), this.used)
            this.used += count
            if (this.used === this.samples.length)
              this.port.postMessage({ samples: this.samples, start: this.start })
            return true
          }
        }
        registerProcessor('seek-capture', Capture)
      `,
            ],
            { type: 'text/javascript' },
          ),
        )
        try {
          await context.audioWorklet.addModule(module)
        } finally {
          URL.revokeObjectURL(module)
        }
        await context.resume()
        const measurements = []
        for (const target of [13.37, 3.28, 18.42, 3.28]) {
          await new Promise<void>((resolve) => {
            audio.addEventListener('seeked', () => resolve(), { once: true })
            audio.currentTime = target
          })
          const capture = new AudioWorkletNode(context, 'seek-capture')
          source.connect(capture).connect(context.destination)
          try {
            const done = new Promise<{
              samples: Float32Array
              firstTime: number
            }>((resolve) => {
              capture.port.onmessage = (
                event: MessageEvent<{ samples: Float32Array; start: number }>,
              ) => {
                const firstTime =
                  audio.currentTime - (context.currentTime - event.data.start)
                audio.pause()
                resolve({ samples: event.data.samples, firstTime })
              }
            })
            await audio.play()
            if (target === 18.42) {
              // Delay the main thread longer than the entire capture. Samples
              // and their starting timestamp must still come from the audio
              // thread, rather than the eventual message-delivery time.
              const until = performance.now() + 1200
              while (performance.now() < until) {
                // Intentionally simulate a busy CI browser.
              }
            }
            const { samples, firstTime } = await done
            const match = await window.correlateWaveform(
              reference.getChannelData(0),
              samples,
              context.sampleRate,
            )
            measurements.push({
              target,
              firstTime,
              ...match,
              error: match.offset - firstTime,
            })
          } finally {
            audio.pause()
            source.disconnect(capture)
            capture.disconnect()
            capture.port.close()
          }
        }
        return { measurements, duration: audio.duration }
      } finally {
        audio.pause()
        source.disconnect()
        await context.close()
        audio.removeAttribute('src')
        audio.load()
      }
    },
    { path },
  )
  await testInfo.attach('audible-seek-measurements', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  expect(result.duration).toBeCloseTo(v.samples / v.sampleRate, 5)
  for (const measurement of result.measurements) {
    expect(
      measurement.correlation,
      JSON.stringify(measurement),
    ).toBeGreaterThan(0.8)
    expect(
      Math.abs(measurement.error),
      JSON.stringify(measurement),
    ).toBeLessThan(0.1)
  }
})
