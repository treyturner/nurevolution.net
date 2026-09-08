import {
  assetsSchema,
  episodeSchema,
  legacySchema,
  showSchema,
  type Catalog,
} from '../../shared/content/schema.ts'
import { normalizeDescription } from './description.ts'
import type { ZodType } from 'zod'

export function parseContentFile<T>(
  schema: ZodType<T>,
  value: unknown,
  file: string,
): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(`${file}: ${result.error.message}`)
  return result.data
}

export function unique(values: string[], label: string) {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label}: duplicate ${value}`)
    seen.add(value)
  }
}

export function validateCatalog(
  input: {
    show: unknown
    assets: unknown
    legacyUrls: unknown
    episodes: { file: string; value: unknown }[]
  },
  authoringAsOf?: number,
): Catalog {
  const show = parseContentFile(showSchema, input.show, 'show.json')
  const assets = parseContentFile(
    assetsSchema,
    input.assets,
    'assets.json',
  ).assets
  const legacyUrls = parseContentFile(
    legacySchema,
    input.legacyUrls,
    'legacy-urls.json',
  ).entries
  const episodes = input.episodes.map(({ file, value }) => {
    const episode = parseContentFile(episodeSchema, value, file)
    if (file !== `episodes/${episode.id}.json`)
      throw new Error(`${file}: filename must equal episode id`)
    const safe = normalizeDescription(episode.descriptionHtml)
    if (safe !== episode.descriptionHtml)
      throw new Error(
        `${file}: descriptionHtml is not canonical safe HTML; candidate: ${JSON.stringify(safe)}`,
      )
    if (
      authoringAsOf !== undefined &&
      episode.status === 'published' &&
      Date.parse(episode.publishedAt!) > authoringAsOf
    ) {
      throw new Error(
        `${file}: future publishedAt; keep the episode draft until publishing (scheduling belongs to M8)`,
      )
    }
    return episode
  })
  unique(
    assets.map((a) => a.id),
    'assets.json id',
  )
  unique(
    episodes.map((e) => e.id),
    'episode id',
  )
  unique(
    episodes.map((e) => e.slug),
    'episode slug',
  )
  unique(
    episodes.map((e) => e.guid),
    'episode guid',
  )
  unique(
    legacyUrls.map((entry) => entry.url),
    'legacy-urls.json url',
  )
  const byId = new Map(assets.map((a) => [a.id, a]))
  function reference(id: string, kind: 'audio' | 'artwork', label: string) {
    const value = byId.get(id)
    if (!value || value.kind !== kind)
      throw new Error(`${label}: ${id} must resolve to ${kind}`)
    return value
  }
  reference(
    show.standardArtworkAssetId,
    'artwork',
    'show.json standardArtworkAssetId',
  )
  reference(
    show.itunesArtworkAssetId,
    'artwork',
    'show.json itunesArtworkAssetId',
  )
  const publishedAudio: string[] = []
  for (const episode of episodes) {
    const audio = reference(
      episode.audioAssetId,
      'audio',
      `${episode.id} audioAssetId`,
    )
    reference(episode.artworkAssetId, 'artwork', `${episode.id} artworkAssetId`)
    if (episode.status === 'published') publishedAudio.push(audio.url)
  }
  unique(publishedAudio, 'published enclosure URL')
  const ids = new Set(episodes.map((e) => e.id))
  for (const entry of legacyUrls)
    if (!ids.has(entry.episodeId))
      throw new Error(`legacy-urls.json: missing episode ${entry.episodeId}`)
  return { show, assets, episodes, legacyUrls }
}

export function countCatalog(catalog: Catalog) {
  return {
    episodes: catalog.episodes.length,
    tracks: catalog.episodes.reduce((sum, e) => sum + e.tracks.length, 0),
    starts: catalog.episodes.reduce(
      (sum, e) => sum + e.tracks.filter((t) => t.startTime !== null).length,
      0,
    ),
    timedEpisodes: catalog.episodes.filter((e) =>
      e.tracks.some((t) => t.startTime !== null),
    ).length,
    assets: catalog.assets.length,
    legacyUrls: catalog.legacyUrls.length,
  }
}
