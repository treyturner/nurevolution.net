import type { EpisodePageState } from '../services/episode-page'

export function useEpisodePage() {
  return useState<EpisodePageState>('episode-page', () => ({
    model: null,
    path: '',
    route: '',
    timestamp: { kind: 'none' },
    pendingPath: null,
    failedPath: null,
  }))
}
