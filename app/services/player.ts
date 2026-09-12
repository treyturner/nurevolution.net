import type { AudioAdapter, AudioEvent } from './audio'

export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'delayed'
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
  let metadataTimer: ReturnType<typeof setTimeout> | undefined
  let metadataRetries = 0
  function stopMetadataTimer() {
    clearTimeout(metadataTimer)
    metadataTimer = undefined
  }
  function hasMetadata(snapshot: ReturnType<AudioAdapter['snapshot']>) {
    return (
      snapshot.readyState >= 1 &&
      Number.isFinite(snapshot.duration) &&
      snapshot.duration > 0
    )
  }
  function watchMetadata() {
    stopMetadataTimer()
    const own = generation
    metadataTimer = setTimeout(() => {
      metadataTimer = undefined
      if (disposed || own !== generation || !source) return
      const snapshot = audio.snapshot()
      if (snapshot.src !== source.url) return
      if (snapshot.error) {
        observe('error')
        return
      }
      if (snapshot.currentSrc === source.url && hasMetadata(snapshot)) {
        observe('loadedmetadata')
        return
      }
      // Preload is advisory. Never reset an active/pending Play request or
      // replace a blocked-play prompt just because metadata was deferred.
      if (!snapshot.paused || snapshot.ended || status === 'blocked') return
      if (metadataRetries++ === 0) {
        load(source, false)
      } else {
        set('delayed')
      }
    }, 10_000)
  }
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
      stopMetadataTimer()
      audio.setPreload('metadata')
      generation++
      set('error')
      if (!snapshot.paused) audio.pause()
      return
    }
    if (hasMetadata(snapshot)) {
      stopMetadataTimer()
      audio.setPreload('metadata')
    } else if (!snapshot.paused || snapshot.ended) {
      stopMetadataTimer()
    } else if (event === 'progress' && status === 'loading') {
      watchMetadata()
    }
    if (snapshot.ended) {
      set('ended')
      return
    }
    if (event === 'pause' && snapshot.paused) {
      // A queued source-reset pause must not erase an autoplay rejection.
      if (status !== 'blocked' && status !== 'error' && status !== 'delayed') {
        const ready = hasMetadata(snapshot)
        set(ready ? 'paused' : 'loading')
        // Play cancels background recovery. Resume it if the listener pauses
        // before metadata arrives, even when the network sends no more events.
        if (!ready && metadataTimer === undefined) watchMetadata()
      }
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
      (event === 'loadedmetadata' ||
        event === 'durationchange' ||
        event === 'loadeddata' ||
        event === 'canplay' ||
        event === 'canplaythrough' ||
        event === 'progress') &&
      hasMetadata(snapshot) &&
      snapshot.paused &&
      status !== 'blocked'
    ) {
      set('paused')
    }
  }
  const unsubscribe = (
    [
      'loadedmetadata',
      'durationchange',
      // WebKit can report duration=0 in the early metadata events and only
      // expose its positive duration when data becomes ready for playback.
      'loadeddata',
      'canplay',
      'canplaythrough',
      'progress',
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
    // Fetch through large MP3 tags before reducing background buffering.
    audio.setPreload('auto')
    audio.load(next.url)
    watchMetadata()
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
              ? hasMetadata(snapshot)
                ? 'paused'
                : 'loading'
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
        stopMetadataTimer()
        source = null
        generation++
        audio.setPreload('metadata')
        audio.pause()
        set('idle')
        return
      }
      const snapshot = audio.snapshot()
      metadataRetries = 0
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
      metadataRetries = 0
      load(source, false)
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopMetadataTimer()
      generation++
      for (const stop of unsubscribe) stop()
      audio.dispose()
    },
  }
}
