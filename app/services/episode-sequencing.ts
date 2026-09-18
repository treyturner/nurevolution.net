import type { EpisodeSummary } from '../../shared/content/public'
export type EpisodeDirection = 'previous' | 'next'
export type EpisodeSort = 'newest-first' | 'oldest-first'
export type EpisodeMoveResult = 'committed' | 'failed' | 'cancelled'
export function orderedEpisodes(episodes: EpisodeSummary[], sort: EpisodeSort) {
  return sort === 'newest-first' ? episodes : [...episodes].reverse()
}
export function episodeNeighbor(
  episodes: EpisodeSummary[],
  id: string | null,
  direction: EpisodeDirection,
) {
  const index = episodes.findIndex((episode) => episode.id === id)
  if (index < 0) return null
  return episodes[
    (index + (direction === 'next' ? 1 : -1) + episodes.length) %
      episodes.length
  ]!
}
interface SequenceHost {
  neighbor(direction: EpisodeDirection): EpisodeSummary | null
  currentId(): string | null
  pending(): boolean
  navigate(target: EpisodeSummary, replace: boolean): Promise<EpisodeMoveResult>
  restart(): void
  play(): void
}
export function createEpisodeSequencer(
  host: SequenceHost,
  changed: () => void,
) {
  let moving = false
  let continuing = false
  let disposed = false
  let failed = false
  async function go(
    target: EpisodeSummary | null,
    mode: 'manual' | 'automatic' | 'play',
  ) {
    if (disposed || moving || host.pending()) return
    if (!target) return
    const automatic = mode === 'automatic'
    failed = false
    if (target.id === host.currentId()) {
      changed()
      if (mode !== 'play') host.restart()
      if (mode !== 'manual') host.play()
      return
    }
    moving = true
    continuing = mode !== 'manual'
    changed()
    try {
      const result = await host.navigate(target, automatic)
      failed = result === 'failed'
      if (
        !disposed &&
        result === 'committed' &&
        continuing &&
        host.currentId() === target.id
      )
        host.play()
    } catch {
      failed = true
    } finally {
      moving = false
      continuing = false
      if (!disposed) changed()
    }
  }
  return {
    snapshot: () => ({
      failed,
      busy: moving || host.pending(),
      continuing,
      available: host.neighbor('next') !== null,
    }),
    manual: (direction: EpisodeDirection) =>
      go(host.neighbor(direction), 'manual'),
    ended: () => go(host.neighbor('next'), 'automatic'),
    play: (target: EpisodeSummary) => go(target, 'play'),
    selected() {
      failed = false
      changed()
    },
    pause() {
      continuing = false
      changed()
    },
    dispose() {
      disposed = true
      continuing = false
    },
  }
}
