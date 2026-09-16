import { contentRepository } from './content.ts'
import { createHeaderCache, matchPlayback } from '../playback/index.ts'
import {
  playbackManifestSchema,
  playbackPath,
  type PlaybackDescriptor,
} from '../../shared/playback/schema.ts'

let manifest: ReturnType<typeof playbackManifestSchema.parse> | undefined
export async function playbackManifest() {
  manifest ??= playbackManifestSchema.parse(
    await useStorage('assets:playback').getItem('manifest.json'),
  )
  return manifest
}
export const playbackHeader = createHeaderCache(async (name) => {
  const bytes = await useStorage('assets:playback').getItemRaw<Uint8Array>(name)
  if (!bytes) throw new Error('Missing playback header')
  return bytes
})
export async function findPlayback(path: string) {
  const entry = matchPlayback(await playbackManifest(), path)
  if (!entry) return undefined
  const asset = (await contentRepository.audioAssets(Date.now())).find(
    (asset) =>
      asset.id === entry.assetId &&
      asset.sha256 === entry.sourceSha256 &&
      asset.byteLength === entry.sourceByteLength,
  )
  return asset ? { entry, asset } : undefined
}
export async function playbackDescriptor(
  audioUrl: string,
): Promise<PlaybackDescriptor | undefined> {
  const config = useRuntimeConfig()
  if (!config.virtualPlayback || !config.audioRoot) return undefined
  const asset = (await contentRepository.audioAssets(Date.now())).find(
    (asset) => asset.url === audioUrl,
  )
  const entry =
    asset &&
    (await playbackManifest()).entries.find(
      (item) =>
        item.assetId === asset.id &&
        item.sourceSha256 === asset.sha256 &&
        item.sourceByteLength === asset.byteLength,
    )
  const path = entry && playbackPath(entry)
  return path
    ? {
        url:
          (config.public.mediaOrigin ||
            (import.meta.dev ? '' : 'https://podcast.nurevolution.net')) + path,
        mediaType: 'audio/mp4',
        codecs: 'mp4a.6B',
      }
    : undefined
}
