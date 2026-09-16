// Opt-in real-archive acceptance; prepared references come from references.py.
import http from 'node:http'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
const root = '.local/playback/references/'
const cases = JSON.parse(fs.readFileSync(root + 'cases.json'))
const mediaOrigin = process.argv[2] || 'http://localhost:3000'
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1))
  if (cases.some((c) => c.reference === name)) {
    res.setHeader('Content-Type', 'audio/wav')
    fs.createReadStream(root + name).pipe(res)
  } else {
    res.setHeader('Content-Type', 'text/html')
    res.end('<title>Local audible seek verification</title>')
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const results = []
try {
  for (const c of cases) {
    c.mediaOrigin = mediaOrigin
    const page = await browser.newPage()
    await page.goto('http://127.0.0.1:' + server.address().port)
    const captured = await page.evaluate(async (c) => {
      const context = new AudioContext({ sampleRate: 44100 })
      const audio = new Audio()
      audio.preload = 'auto'
      audio.crossOrigin = 'anonymous'
      audio.src = c.mediaOrigin + c.path
      document.body.append(audio)
      await new Promise((resolve, reject) => {
        audio.onloadedmetadata = resolve
        audio.onerror = () => reject(Error(audio.error.message))
      })
      const source = context.createMediaElementSource(audio)
      // Capture on the audio thread. ScriptProcessor drops blocks when the
      // main thread is busy, making waveform comparison inconclusive.
      const module = URL.createObjectURL(
        new Blob(
          [
            `
        class Capture extends AudioWorkletProcessor {
          constructor() { super(); this.samples = new Float32Array(204800); this.used = 0; this.start = null }
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
            if (this.used === this.samples.length) this.port.postMessage({samples:this.samples, start:this.start})
            return true
          }
        }
        registerProcessor('capture', Capture)
      `,
          ],
          { type: 'text/javascript' },
        ),
      )
      await context.audioWorklet.addModule(module)
      URL.revokeObjectURL(module)
      const processor = new AudioWorkletNode(context, 'capture')
      source.connect(processor)
      processor.connect(context.destination)
      await context.resume()
      audio.currentTime = c.target
      await new Promise((resolve) =>
        audio.addEventListener('seeked', resolve, { once: true }),
      )
      let firstMediaTime = null
      let firstContextTime = null
      const captured = new Promise(
        (resolve) =>
          (processor.port.onmessage = (event) => {
            firstContextTime = event.data.start
            firstMediaTime =
              audio.currentTime - (context.currentTime - firstContextTime)
            audio.pause()
            resolve(event.data.samples)
          }),
      )
      await audio.play()
      const samples = await captured
      const result = {
        episode: c.episode,
        requested: c.target,
        duration: audio.duration,
        firstMediaTime,
        firstContextTime,
        referenceStart: c.referenceStart,
        samples: Array.from(samples),
      }
      source.disconnect()
      processor.disconnect()
      await context.close()
      audio.src = ''
      return result
    }, c)
    const capturePath = '.local/playback/captured.f32'
    fs.writeFileSync(
      capturePath,
      Buffer.from(Float32Array.from(captured.samples).buffer),
    )
    const { stdout } = await exec(
      process.env.PLAYBACK_PYTHON || '.local/playback-venv/bin/python',
      ['tools/playback/correlate.py', root + c.reference, capturePath],
    )
    const match = JSON.parse(stdout)
    delete captured.samples
    const timing = captured
    const sourceTime = c.referenceStart + match.offset
    const result = {
      ...timing,
      sourceTime,
      sourceAheadSeconds: sourceTime - captured.firstMediaTime,
      correlation: match.correlation,
    }
    results.push(result)
    console.log(JSON.stringify(result))
    assert.ok(result.correlation > 0.8, 'Audio comparison must be conclusive')
    assert.ok(
      Math.abs(result.sourceAheadSeconds) < 0.1,
      'Audio must align within 100ms',
    )
    await page.close()
  }
  fs.writeFileSync(
    '.local/playback/audible.json',
    JSON.stringify({ browser: await browser.version(), results }, null, 2) +
      '\n',
  )
} finally {
  await browser.close()
  await new Promise((r) => server.close(r))
}
