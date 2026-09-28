// Runs in the browser via addScriptTag. Search the whole reference without
// using the requested seek time, so a genuinely wrong seek still fails.
export async function correlateWaveform(
  reference: Float32Array,
  captured: Float32Array,
  sampleRate: number,
) {
  // Ignore initial decoder/output settling, as in tools/playback/correlate.py.
  const skip = Math.floor(sampleRate / 4)
  const signal = captured.slice(skip)
  if (!signal.length || signal.length > reference.length)
    throw Error('Invalid waveform comparison lengths')
  const mean = signal.reduce((sum, value) => sum + value, 0) / signal.length
  let energy = 0
  for (let i = 0; i < signal.length; i++) {
    signal[i] = signal[i]! - mean
    energy += signal[i]! ** 2
  }
  if (!energy) throw Error('Captured waveform is silent')

  // Linear convolution with the reversed signal gives every correlation lag.
  // The browser's convolver avoids a quadratic sample-by-sample search and
  // retains phase/frequency information that an RMS envelope discards.
  const context = new OfflineAudioContext(
    1,
    reference.length + signal.length - 1,
    sampleRate,
  )
  const input = context.createBuffer(1, reference.length, sampleRate)
  input.copyToChannel(Float32Array.from(reference), 0)
  const kernel = context.createBuffer(1, signal.length, sampleRate)
  kernel.copyToChannel(signal.reverse(), 0)
  const convolver = context.createConvolver()
  convolver.normalize = false
  convolver.buffer = kernel
  const source = context.createBufferSource()
  source.buffer = input
  source.connect(convolver).connect(context.destination)
  source.start()
  const dots = (await context.startRendering()).getChannelData(0)
  let sum = 0,
    squares = 0,
    score = -Infinity,
    best = 0
  for (let i = 0; i < signal.length; i++) {
    sum += reference[i]!
    squares += reference[i]! ** 2
  }
  for (let i = 0; i <= reference.length - signal.length; i++) {
    const variance = Math.max(0, squares - sum ** 2 / signal.length)
    const candidate =
      dots[i + signal.length - 1]! / Math.sqrt(variance * energy)
    if (Number.isFinite(candidate) && candidate > score) {
      score = candidate
      best = i
    }
    if (i < reference.length - signal.length) {
      sum += reference[i + signal.length]! - reference[i]!
      squares += reference[i + signal.length]! ** 2 - reference[i]! ** 2
    }
  }
  return { offset: (best - skip) / sampleRate, correlation: score }
}

declare global {
  interface Window {
    correlateWaveform: typeof correlateWaveform
  }
}
