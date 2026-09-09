import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { archiveCatalog } from '../fixtures/archive'
import {
  episodeDetail,
  episodeSummary,
  selectPublic,
  showPublic,
} from '../../shared/content/public'
const episodes = selectPublic(archiveCatalog, Date.parse('2026-09-08'))
registerEndpoint('/api/show', () => showPublic(archiveCatalog))
registerEndpoint('/api/episodes', () => ({
  episodes: episodes.map((e) => episodeSummary(archiveCatalog, e)),
}))
for (const episode of episodes)
  registerEndpoint(`/api/episodes/${episode.slug}`, () =>
    episodeDetail(archiveCatalog, episode),
  )
