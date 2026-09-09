import type { AudioAdapter, AudioEvent } from './audio'

export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'paused'
  | 'playing'
  | 'buffering'
  | 'ended'
  | 'error'
  | 'blocked'
export interface PlayerSource {
  id: string
  url: string
}

/** One element, with asynchronous work scoped to its current source and play intent. */
export function createPlayer(
  audio: AudioAdapter,
  changed: (status: PlayerStatus) => void,
) {
  let source: PlayerSource | null = null
  let generation = 0
  let disposed = false
  let status: PlayerStatus = 'idle'
  function set(next: PlayerStatus) {
    status = next
    changed(next)
  }
  function current() {
    const snapshot = audio.snapshot()
    return source &&
      snapshot.src === source.url &&
      (!snapshot.currentSrc || snapshot.currentSrc === source.url)
      ? snapshot
      : null
  }
  function observe(event: AudioEvent) {
    const snapshot = current()
    if (!snapshot) return
    if (snapshot.error) {
      generation++
      set('error')
      if (!snapshot.paused) audio.pause()
      return
    }
    if (snapshot.ended) {
      set('ended')
      return
    }
    if (event === 'pause' && snapshot.paused) {
      // A queued source-reset pause must not erase an autoplay rejection.
      if (status !== 'blocked') set('paused')
    } else if (
      (event === 'play' || event === 'playing' || event === 'waiting') &&
      !snapshot.paused
    ) {
      set(
        event === 'playing' && snapshot.readyState >= 3
          ? 'playing'
          : 'buffering',
      )
    } else if (
      event === 'loadedmetadata' &&
      snapshot.readyState >= 1 &&
      snapshot.paused &&
      status !== 'blocked'
    ) {
      set('paused')
    }
  }
  const unsubscribe = (
    [
      'loadedmetadata',
      'play',
      'playing',
      'waiting',
      'pause',
      'ended',
      'error',
    ] as const
  ).map((event) => audio.subscribe(event, () => observe(event)))
  function load(next: PlayerSource, continuePlaying: boolean) {
    const own = ++generation
    source = next
    set('loading')
    audio.load(next.url)
    if (continuePlaying) {
      // Call immediately: native controls can then cancel the pending play request.
      void audio.play().catch((error: unknown) => {
        if (disposed || own !== generation) return
        const snapshot = current()
        if (!snapshot) return
        if (snapshot.error) observe('error')
        else if (snapshot.paused) {
          // Native pause cancels a pending play with AbortError. A reset pause
          // alone does not determine the outcome of the new play request.
          set(
            error instanceof Error && error.name === 'AbortError'
              ? 'paused'
              : 'blocked',
          )
        }
      })
    }
  }
  return {
    select(next: PlayerSource | null) {
      if (disposed || next?.id === source?.id) return
      if (!next) {
        source = null
        generation++
        audio.pause()
        set('idle')
        return
      }
      const snapshot = audio.snapshot()
      load(
        next,
        Boolean(
          source && !snapshot.error && !snapshot.ended && !snapshot.paused,
        ),
      )
    },
    retry() {
      if (disposed || !source) return
      audio.pause()
      load(source, false)
    },
    dispose() {
      if (disposed) return
      disposed = true
      generation++
      for (const stop of unsubscribe) stop()
      audio.dispose()
    },
  }
}
