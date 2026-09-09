import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  assetSchema,
  hashSchema,
  idSchema,
  instantSchema,
  type Asset,
  type Catalog,
} from '../../shared/content/schema.ts'
import { selectPublic } from '../../shared/content/public.ts'
import { attachment } from '../../server/downloads/filename.ts'

export const commitSchema = z.string().regex(/^[a-f0-9]{40}$/)
export const downloadSchema = z.strictObject({
  slug: idSchema,
  disposition: z.string(),
})
export const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sourceCommit: commitSchema,
  asOf: instantSchema,
  assets: z.array(
    z.strictObject({
      asset: assetSchema,
      public: z.boolean(),
      episodeSlugs: z.array(idSchema),
      downloads: z.array(downloadSchema),
    }),
  ),
  episodes: z.array(
    z.strictObject({
      slug: idSchema,
      guid: z.string(),
      guidIsPermalink: z.boolean(),
      enclosure: z.string(),
      byteLength: z.int().positive(),
      mediaType: z.literal('audio/mpeg'),
    }),
  ),
})
export type MediaManifest = z.infer<typeof manifestSchema>
export const serialize = (value: unknown) =>
  JSON.stringify(value, null, 2) + '\n'
export const sha256 = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex')

export function safeAsset(asset: Asset) {
  assetSchema.parse(asset)
  const url = new URL(asset.url)
  const path = decodeURIComponent(url.pathname)
  // Caddy path matchers and placeholders must never interpret catalog text.
  if (
    url.search ||
    /[{}*?\[\]\\\p{Cc}]/u.test(path + asset.relativePath) ||
    path.split('/').some((part) => part === '..' || part === '.') ||
    path.includes('//')
  )
    throw new Error(`Unsafe delivery path: ${asset.id}`)
  const expected =
    asset.kind === 'audio'
      ? ['podcast.nurevolution.net', '/' + asset.relativePath]
      : ['nurevolution.net', '/wp/wp-content/uploads/' + asset.relativePath]
  if (
    url.protocol !== 'https:' ||
    url.host !== expected[0] ||
    path !== expected[1]
  )
    throw new Error(`Unmapped canonical URL: ${asset.id}`)
  return path
}

export function createManifest(
  catalog: Catalog,
  sourceCommit: string,
  asOf: string,
  historical: Asset[] = [],
): MediaManifest {
  commitSchema.parse(sourceCommit)
  instantSchema.parse(asOf)
  if (
    catalog.episodes.some(
      (e) =>
        e.status === 'published' &&
        Date.parse(e.publishedAt!) > Date.parse(asOf),
    )
  )
    throw new Error('Scheduled delivery requires M8')
  const publicEpisodes = selectPublic(catalog, Date.parse(asOf))
  const showAssets = [
    catalog.show.standardArtworkAssetId,
    catalog.show.itunesArtworkAssetId,
  ]
  const assets = [...catalog.assets]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((asset) => {
      safeAsset(asset)
      const uses = publicEpisodes.filter((e) =>
        [e.audioAssetId, e.artworkAssetId].includes(asset.id),
      )
      const privateUse = catalog.episodes.some(
        (e) =>
          !publicEpisodes.includes(e) &&
          [e.audioAssetId, e.artworkAssetId].includes(asset.id),
      )
      const historicalArtwork =
        asset.kind === 'artwork' &&
        !privateUse &&
        historical.some(
          (old) =>
            old.id === asset.id &&
            old.url === asset.url &&
            old.sha256 === asset.sha256,
        )
      return {
        asset,
        public:
          uses.length > 0 || showAssets.includes(asset.id) || historicalArtwork,
        episodeSlugs: uses.map((e) => e.slug).sort(),
        downloads:
          asset.kind === 'audio'
            ? uses
                .map((e) => ({
                  slug: e.slug,
                  disposition: attachment(
                    asset.relativePath.split('/').at(-1)!,
                  ),
                }))
                .sort((a, b) => a.slug.localeCompare(b.slug))
            : [],
      }
    })
  const manifest = manifestSchema.parse({
    schemaVersion: 1,
    sourceCommit,
    asOf,
    assets,
    episodes: publicEpisodes
      .map((e) => {
        const audio = catalog.assets.find((a) => a.id === e.audioAssetId)!
        return {
          slug: e.slug,
          guid: e.guid,
          guidIsPermalink: e.guidIsPermalink,
          enclosure: audio.url,
          byteLength: audio.byteLength,
          mediaType: audio.mediaType,
        }
      })
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  })
  validateManifest(manifest)
  return manifest
}

export function validateManifest(value: unknown): MediaManifest {
  const manifest = manifestSchema.parse(value)
  const ids = new Set<string>(),
    paths = new Set<string>(),
    downloads = new Set<string>()
  for (const entry of manifest.assets) {
    safeAsset(entry.asset)
    const path = entry.asset.sourceRoot + '/' + entry.asset.relativePath
    if (ids.has(entry.asset.id) || paths.has(path))
      throw new Error('Duplicate media mapping')
    ids.add(entry.asset.id)
    paths.add(path)
    if (!entry.public && entry.downloads.length)
      throw new Error('Private download mapping')
    for (const download of entry.downloads) {
      if (
        entry.asset.kind !== 'audio' ||
        downloads.has(download.slug) ||
        !entry.episodeSlugs.includes(download.slug) ||
        download.disposition !==
          attachment(entry.asset.relativePath.split('/').at(-1)!)
      )
        throw new Error('Invalid download mapping')
      downloads.add(download.slug)
      const episode = manifest.episodes.find((e) => e.slug === download.slug)
      if (
        !episode ||
        episode.enclosure !== entry.asset.url ||
        episode.byteLength !== entry.asset.byteLength
      )
        throw new Error('Download identity mismatch')
    }
  }
  if (
    downloads.size !== manifest.episodes.length ||
    new Set(manifest.episodes.map((e) => e.slug)).size !== downloads.size
  )
    throw new Error('Incomplete episode delivery')
  return manifest
}

export function assertRollbackCompatible(
  active: MediaManifest,
  fallback: MediaManifest,
) {
  validateManifest(active)
  validateManifest(fallback)
  for (const episode of active.episodes) {
    const previous = fallback.episodes.find((e) => e.slug === episode.slug)
    if (!previous || serialize(previous) !== serialize(episode))
      throw new Error(
        'Rollback would withdraw published content or change subscriber identity',
      )
  }
}

export function verifyHash(bytes: string, expected: string) {
  hashSchema.parse(expected)
  if (sha256(bytes) !== expected) throw new Error('Artifact checksum mismatch')
}
