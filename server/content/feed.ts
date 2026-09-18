import type { Catalog } from '../../shared/content/schema.ts'
import {
  episodeDetail,
  selectPublic,
  showPublic,
} from '../../shared/content/public.ts'
import { requireRssMetadata } from './validate.ts'

export function publicFeedArchive(catalog: Catalog, asOf: number) {
  const rss = requireRssMetadata(catalog.show)
  const links = new Map<string, string>()
  for (const entry of [...catalog.legacyUrls].sort((a, b) =>
    a.url < b.url ? -1 : a.url > b.url ? 1 : 0,
  )) {
    if (!links.has(entry.episodeId)) links.set(entry.episodeId, entry.url)
  }
  return {
    show: { ...showPublic(catalog), rss: structuredClone(rss) },
    episodes: selectPublic(catalog, asOf).map((episode) => {
      const detail = episodeDetail(catalog, episode)
      return {
        ...detail,
        rss: {
          link:
            links.get(episode.id) ??
            new URL(detail.path, catalog.show.siteUrl).href,
          explicit: episode.explicit ?? rss.explicit,
        },
      }
    }),
  }
}

export type PodcastArchive = ReturnType<typeof publicFeedArchive>
