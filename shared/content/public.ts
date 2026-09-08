import type { Asset, Catalog, Episode } from './schema.ts'

export function selectPublic(catalog: Catalog, asOf: number): Episode[] {
  if (!Number.isFinite(asOf))
    throw new Error('Public selection requires a finite asOf instant')
  return catalog.episodes
    .filter(
      (episode) =>
        episode.status === 'published' &&
        episode.publishedAt !== null &&
        Date.parse(episode.publishedAt) <= asOf,
    )
    .sort(
      (a, b) =>
        Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
}

function asset(catalog: Catalog, id: string): Asset {
  const value = catalog.assets.find((item) => item.id === id)
  if (!value) throw new Error(`Missing asset: ${id}`)
  return value
}

export function showPublic(catalog: Catalog) {
  const show = catalog.show
  return {
    id: show.id,
    title: show.title,
    descriptionText: show.descriptionText,
    siteUrl: show.siteUrl,
    feedUrl: show.feedUrl,
    standardArtworkUrl: asset(catalog, show.standardArtworkAssetId).url,
    itunesArtworkUrl: asset(catalog, show.itunesArtworkAssetId).url,
  }
}

export function episodeSummary(catalog: Catalog, episode: Episode) {
  return {
    id: episode.id,
    slug: episode.slug,
    path: `/episodes/${episode.slug}`,
    title: episode.title,
    artist: episode.artist,
    publishedAt: episode.publishedAt,
    durationSeconds: episode.durationSeconds,
    artworkUrl: asset(catalog, episode.artworkAssetId).url,
  }
}

export function episodeDetail(catalog: Catalog, episode: Episode) {
  const audio = asset(catalog, episode.audioAssetId)
  return {
    ...episodeSummary(catalog, episode),
    descriptionHtml: episode.descriptionHtml,
    guid: episode.guid,
    guidIsPermalink: episode.guidIsPermalink,
    audio: {
      url: audio.url,
      mediaType: audio.mediaType,
      byteLength: audio.byteLength,
      downloadFilename: audio.relativePath.split('/').at(-1)!,
    },
    tracks: episode.tracks.map((track) => ({
      position: track.position,
      artist: track.artist,
      title: track.title,
      startTime: track.startTime,
    })),
  }
}

export type PublicShow = ReturnType<typeof showPublic>
export type EpisodeSummary = ReturnType<typeof episodeSummary>
export type EpisodeDetail = ReturnType<typeof episodeDetail>
