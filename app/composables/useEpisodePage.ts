import type { EpisodePageState } from '../services/episode-page'

export function useEpisodePage() {
  return useState<EpisodePageState>('episode-page', () => ({
    model: null,
    path: '',
    pendingPath: null,
    failedPath: null,
  }))
}
