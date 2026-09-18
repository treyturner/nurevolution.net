import type { AudioEvent } from './audio'
import type { PlayerSnapshot } from './player'

/** Stabilize track identity during Safari's brief clock rollback after a seek. */
export function createTrackClock(now: () => number = Date.now) {
  let source: string | null = null
  let anchor: number | null = null
  let startedAt: number | null = null
  const clock = (state: PlayerSnapshot, event?: AudioEvent) => {
    const time = state.currentTime
    if (
      source !== state.sourceId ||
      state.pendingSeek !== null ||
      state.seeking ||
      state.status === 'loading' ||
      state.status === 'error'
    ) {
      anchor = startedAt = null
    }
    source = state.sourceId
    if (event === 'seeked' && state.pendingSeek === null && !state.seeking) {
      anchor = time
      startedAt = null
    }
    if (anchor === null) return time
    // A paused seek can wait indefinitely for Play. Start the bounded grace
    // period only when playback emits its first clock update after that seek.
    if (event === 'timeupdate' && state.wantsPlay) startedAt ??= now()
    if (
      time > anchor ||
      anchor - time > 0.5 ||
      (startedAt !== null && now() - startedAt >= 1000)
    ) {
      anchor = startedAt = null
      return time
    }
    return Math.max(time, anchor)
  }
  clock.reset = () => {
    anchor = startedAt = null
  }
  return clock
}
