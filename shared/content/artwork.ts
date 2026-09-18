import type { Asset } from './schema.ts'

export const thumbnailSize = 96
export const episodeArtworkSize = 1400
export const episodeArtworkMaxBytes = 512 * 1024

export function episodeArtworkPath(asset: Pick<Asset, 'sha256'>) {
  return `/episode-artwork/v1-${asset.sha256}.jpg`
}

// Version the recipe when changing encoding or crop behavior.
export function artworkThumbnailPath(asset: Pick<Asset, 'sha256'>) {
  return `/artwork-thumbnails/v1-${asset.sha256}.webp`
}
