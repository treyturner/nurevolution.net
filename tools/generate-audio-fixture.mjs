import { mkdir, writeFile } from 'node:fs/promises'

for (const [name, sampleRate, seconds] of [
  ['sample.wav', 22_050, 2],
  ['long.wav', 8_000, 40],
]) {
  const sampleCount = sampleRate * seconds
  const dataBytes = sampleCount * 2
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < sampleCount; index++) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate)
    wav.writeInt16LE(Math.round(sample * 0.05 * 32_767), 44 + index * 2)
  }
  const directory = new URL(
    '../test/fixtures/media-app/public/',
    import.meta.url,
  )
  await mkdir(directory, { recursive: true })
  await writeFile(new URL(name, directory), wav)
}
