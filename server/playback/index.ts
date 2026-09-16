import { createHash } from 'node:crypto'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import type { Asset } from '../../shared/content/schema.ts'
import {
  playbackManifestSchema,
  type PlaybackManifest,
  type PlaybackEntry,
} from '../../shared/playback/schema.ts'

const decompress = promisify(gunzip)
export function validatePlayback(value: unknown, assets: Asset[]) {
  const manifest = playbackManifestSchema.parse(value)
  const audio = assets.filter((asset) => asset.kind === 'audio')
  if (audio.length !== manifest.entries.length)
    throw new Error('Incomplete playback coverage')
  for (const asset of audio) {
    const entry = manifest.entries.find((item) => item.assetId === asset.id)
    if (
      !entry ||
      entry.sourceSha256 !== asset.sha256 ||
      entry.sourceByteLength !== asset.byteLength
    )
      throw new Error(`Stale playback source: ${asset.id}`)
  }
  return manifest
}

export async function decodeHeader(
  compressed: Uint8Array,
  entry: PlaybackEntry,
) {
  const v = entry.virtual
  if (!v) throw new Error('No virtual representation')
  const header = await decompress(compressed, {
    maxOutputLength: v.headerByteLength,
  })
  if (
    header.length !== v.headerByteLength ||
    createHash('sha256').update(header).digest('hex') !== v.headerSha256
  )
    throw new Error('Playback header identity mismatch')
  let position = 0
  let moov = false
  while (position < header.length) {
    if (position + 8 > header.length) throw new Error('Truncated MP4 atom')
    const kind = header.toString('ascii', position + 4, position + 8)
    let size = header.readUInt32BE(position),
      width = 8
    if (size === 1) {
      if (position + 16 > header.length) throw new Error('Truncated MP4 atom')
      size = Number(header.readBigUInt64BE(position + 8))
      width = 16
    }
    if (!Number.isSafeInteger(size) || size < width)
      throw new Error('Invalid MP4 atom')
    if (position === 0 && kind !== 'ftyp')
      throw new Error('Missing MP4 file type')
    if (kind === 'moov') moov = true
    if (kind === 'mdat') {
      if (
        !moov ||
        position + width !== header.length ||
        size !== width + v.audioByteLength
      )
        throw new Error('Invalid MP4 audio span')
      return header
    }
    position += size
  }
  throw new Error('Missing MP4 audio atom')
}

/** Bounded LRU; parallel loads of the same immutable header share their work. */
export function createHeaderCache(
  read: (name: string) => Promise<Uint8Array>,
  limit = 16 * 1024 * 1024,
) {
  const cache = new Map<string, Buffer>()
  const pending = new Map<string, Promise<Buffer>>()
  let bytes = 0
  return async (entry: PlaybackEntry) => {
    const key = entry.virtual!.sha256
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }
    let loading = pending.get(key)
    if (!loading) {
      loading = read(`headers/${key}.gz`)
        .then((compressed) => decodeHeader(compressed, entry))
        .then((header) => {
          while (bytes + header.length > limit && cache.size) {
            const oldest = cache.keys().next().value!
            bytes -= cache.get(oldest)!.length
            cache.delete(oldest)
          }
          if (header.length <= limit) {
            cache.set(key, header)
            bytes += header.length
          }
          return header
        })
        .finally(() => pending.delete(key))
      pending.set(key, loading)
    }
    return loading
  }
}

export function matchPlayback(manifest: PlaybackManifest, pathname: string) {
  const match = /^\/playback\/([a-f0-9]{64})\/([a-f0-9]{64})\.m4a$/.exec(
    pathname,
  )
  return (
    match &&
    manifest.entries.find(
      (entry) =>
        entry.sourceSha256 === match[1] && entry.virtual?.sha256 === match[2],
    )
  )
}
