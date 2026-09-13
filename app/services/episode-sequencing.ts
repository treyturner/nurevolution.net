import type { EpisodeSummary } from '../../shared/content/public'
export type EpisodeDirection = 'older' | 'newer'
export type EpisodeMoveResult = 'committed' | 'failed' | 'cancelled'
export function episodeNeighbor(
  episodes: EpisodeSummary[],
  id: string | null,
  direction: EpisodeDirection,
) {
  const index = episodes.findIndex((episode) => episode.id === id)
  if (index < 0) return null
  return episodes[
    (index + (direction === 'older' ? 1 : -1) + episodes.length) %
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
  let order: EpisodeDirection = 'older'
  let moving = false
  let continuing = false
  let disposed = false
  let failed = false
  async function go(direction: EpisodeDirection, automatic: boolean) {
    if (disposed || moving || host.pending()) return
    const target = host.neighbor(direction)
    if (!target) return
    failed = false
    if (target.id === host.currentId()) {
      changed()
      host.restart()
      if (automatic) host.play()
      return
    }
    moving = true
    continuing = automatic
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
      order,
      failed,
      busy: moving || host.pending(),
      continuing,
      available: host.neighbor('older') !== null,
    }),
    manual: (direction: EpisodeDirection) => go(direction, false),
    ended: () => go(order, true),
    selected() {
      failed = false
      changed()
    },
    pause() {
      continuing = false
      changed()
    },
    setOrder(direction: EpisodeDirection) {
      order = direction
      changed()
    },
    dispose() {
      disposed = true
      continuing = false
    },
  }
}
