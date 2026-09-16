import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { Asset } from '../../../shared/content/schema'
import type { PlaybackEntry } from '../../../shared/playback/schema'

export const hash = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex')
export function atom(
  kind: string,
  payload = Buffer.alloc(0),
  size = payload.length + 8,
) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(size)
  header.write(kind, 4)
  return Buffer.concat([header, payload])
}
export function fixture() {
  const audio = Buffer.from('0123456789abcdef')
  const source = Buffer.concat([Buffer.from('TAG'), audio, Buffer.from('END')])
  const header = Buffer.concat([
    atom('ftyp'),
    atom('moov'),
    atom('mdat', Buffer.alloc(0), 8 + audio.length),
  ])
  const body = Buffer.concat([header, audio])
  const asset: Asset = {
    id: 'test-audio',
    kind: 'audio',
    url: 'https://podcast.nurevolution.net/test.mp3',
    sourceRoot: 'audio',
    relativePath: 'test.mp3',
    mediaType: 'audio/mpeg',
    byteLength: source.length,
    sha256: hash(source),
  }
  const entry: PlaybackEntry = {
    assetId: asset.id,
    sourceSha256: asset.sha256,
    sourceByteLength: source.length,
    mode: 'VBR',
    bitrates: [128, 320],
    frameCount: 2,
    virtual: {
      sha256: hash(body),
      headerSha256: hash(header),
      headerByteLength: header.length,
      byteLength: body.length,
      audioOffset: 3,
      audioByteLength: audio.length,
      samples: 2000,
      sampleRate: 44100,
      pcmSha256: [hash('pcm')],
    },
  }
  return {
    asset,
    entry,
    source,
    header,
    body,
    compressed: gzipSync(header),
    manifest: {
      schemaVersion: 1,
      generator: 'PyAV 16.1.0 / libavformat 62.3.100',
      entries: [entry],
    },
  }
}
