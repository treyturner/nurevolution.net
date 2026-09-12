import type { Asset } from './schema.ts'

export const thumbnailSize = 96

// Version the recipe when changing encoding or crop behavior.
export function artworkThumbnailPath(asset: Pick<Asset, 'sha256'>) {
  return `/artwork-thumbnails/v1-${asset.sha256}.webp`
}
