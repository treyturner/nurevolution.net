import type { AudioAdapter, AudioEvent } from './audio'

export function seekTarget(
  seconds: number,
  duration: number,
  ranges: { start: number; end: number }[],
) {
  let target = Math.min(duration, Math.max(0, seconds))
  if (
    ranges.length &&
    !ranges.some((r) => target >= r.start && target <= r.end)
  ) {
    target = ranges
      .flatMap((r) => [r.start, r.end])
      .reduce((nearest, value) =>
        Math.abs(value - target) < Math.abs(nearest - target) ||
        (Math.abs(value - target) === Math.abs(nearest - target) &&
          value < nearest)
          ? value
          : nearest,
      )
  }
  return Math.min(duration, Math.max(0, target))
}

/** A single replaceable seek, retained through a metadata-only load retry. */
export function createPlayerSeek(audio: AudioAdapter, changed: () => void) {
  let pending: number | null = null
  let applied: number | null = null
  let message: string | null = null
  let restore = false
  let failedTarget: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  function clear() {
    clearTimeout(timer)
    timer = undefined
    pending = applied = null
  }
  function fail() {
    failedTarget = applied
    clear()
    message = restore
      ? 'Saved position could not be restored.'
      : 'Could not seek. Try again.'
    changed()
  }
  return {
    snapshot: () => ({ pendingSeek: pending, seekMessage: message }),
    request(seconds: number, restoring = false) {
      if (!Number.isFinite(seconds)) return
      clear()
      message = null
      failedTarget = null
      restore = restoring
      pending = Math.max(0, seconds)
    },
    reset(retain = false) {
      clearTimeout(timer)
      timer = undefined
      applied = null
      if (!retain) {
        pending = null
        message = null
        failedTarget = null
      }
    },
    reconcile(
      snapshot: ReturnType<AudioAdapter['snapshot']>,
      event?: AudioEvent,
    ) {
      if (pending === null) {
        if (
          event === 'seeked' &&
          failedTarget !== null &&
          !snapshot.seeking &&
          Math.abs(snapshot.currentTime - failedTarget) <= 0.25
        ) {
          message = null
          failedTarget = null
        }
        return
      }
      if (
        snapshot.readyState < 1 ||
        !Number.isFinite(snapshot.duration) ||
        snapshot.duration <= 0
      )
        return
      const target = seekTarget(pending, snapshot.duration, snapshot.seekable)
      if (applied !== target) {
        applied = target
        // Retain the requested value while bounds evolve, within one deadline.
        timer ??= setTimeout(fail, 5000)
        try {
          audio.seek(target)
        } catch {
          fail()
          return
        }
      }
      const actual = audio.snapshot()
      if (!actual.seeking && Math.abs(actual.currentTime - target) <= 0.25) {
        clear()
        message = null
      }
    },
  }
}
