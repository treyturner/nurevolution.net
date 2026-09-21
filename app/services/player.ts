import type { AudioAdapter, AudioEvent } from './audio'
import { createPlayerSeek } from './player-seek'
import { createPlayerVolume } from './player-volume'

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
  fallbackUrl?: string
}
export interface PlayerSnapshot {
  sourceId: string | null
  status: PlayerStatus
  wantsPlay: boolean
  currentTime: number
  duration: number | null
  seeking: boolean
  pendingSeek: number | null
  seekMessage: string | null
  volume: number
  muted: boolean
  volumeSupported: boolean
  muteSupported: boolean
}
export interface PlayerSelection {
  position?: number
  paused?: boolean
  positionReason?: 'saved' | 'shared'
}

/** One element, with asynchronous work scoped to its current source and play intent. */
export function createPlayer(
  audio: AudioAdapter,
  changed: (status: PlayerStatus) => void,
  observed: (snapshot: PlayerSnapshot, event?: AudioEvent) => void = () => {},
  eligibleEnd: (sourceId: string) => void = () => {},
) {
  let source: PlayerSource | null = null
  let generation = 0
  let disposed = false
  let endArmed = false
  let playedSinceLoad = false
  let status: PlayerStatus = 'idle'
  let metadataTimer: ReturnType<typeof setTimeout> | undefined
  let durationTimer: ReturnType<typeof setTimeout> | undefined
  let metadataRetries = 0
  let wantsPlay = false
  let intent = 0
  const pendingPlays = new Set<number>()
  let deferredPlay = false
  let reconciling = false
  let resetPausePending = false
  let playObservedSinceLoad = false
  let gesturePrepared = false
  let playbackTime: number | null = null
  const failedSources = new Set<string>()
  const seek = createPlayerSeek(audio, () => {
    publish()
    // A timeout can settle a seek without another browser event.
    if (!disposed && !reconciling && deferredPlay) requestPlay()
  })
  const volume = createPlayerVolume(audio)
  function snapshot(): PlayerSnapshot {
    const actual = current()
    return {
      sourceId: source?.id ?? null,
      status,
      wantsPlay,
      currentTime:
        actual && Number.isFinite(actual.currentTime) ? actual.currentTime : 0,
      duration: actual && hasMetadata(actual) ? actual.duration : null,
      seeking: actual?.seeking ?? false,
      ...seek.snapshot(),
      ...volume.snapshot(),
    }
  }
  function publish(event?: AudioEvent) {
    if (!disposed) observed(snapshot(), event)
  }
  function cancelPlay() {
    playbackTime = null
    wantsPlay = false
    deferredPlay = false
    intent++
  }
  function requestPlay() {
    if (disposed || !source) return
    wantsPlay = true
    if (seek.snapshot().pendingSeek !== null) {
      deferredPlay = true
      publish()
      return
    }
    deferredPlay = false
    const ownSource = generation
    const ownIntent = ++intent
    pendingPlays.add(ownIntent)
    const settled = (error?: unknown) => {
      pendingPlays.delete(ownIntent)
      if (disposed) return
      if (ownSource !== generation || ownIntent !== intent) {
        if (!wantsPlay && !audio.snapshot().paused) audio.pause()
        return
      }
      // The request generation identifies this load even before currentSrc
      // catches up. An immediate permission rejection must remain visible.
      const actual = audio.snapshot()
      if (actual.src !== source?.url) return
      if (actual.error) observe('error')
      else if (error && actual.paused) {
        cancelPlay()
        set(
          error instanceof Error && error.name === 'AbortError'
            ? hasMetadata(actual)
              ? 'paused'
              : 'loading'
            : 'blocked',
        )
      }
      publish()
    }
    try {
      void audio.play().then(() => settled(), settled)
    } catch (error) {
      settled(error)
    }
    publish()
  }
  function stopMetadataTimer() {
    clearTimeout(metadataTimer)
    metadataTimer = undefined
  }
  function stopDurationTimer() {
    clearTimeout(durationTimer)
    durationTimer = undefined
  }
  function watchDuration() {
    if (durationTimer !== undefined) return
    const own = generation
    durationTimer = setTimeout(() => {
      if (disposed || own !== generation) return
      durationTimer = undefined
      observe('durationchange')
    }, 250)
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
    }, 15_000)
  }
  function set(next: PlayerStatus) {
    status = next
    changed(next)
    publish()
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
    if (
      event === 'play' ||
      event === 'pause' ||
      event === 'waiting' ||
      event === 'seeking' ||
      event === 'seeked'
    ) {
      playbackTime = null
    }
    const resetPause =
      event === 'pause' && resetPausePending && !playObservedSinceLoad
    if (event === 'pause') resetPausePending = false
    if (snapshot.error) {
      if (source?.fallbackUrl && [2, 3, 4].includes(snapshot.error.code)) {
        failedSources.add(source.url)
        const position = seek.snapshot().pendingSeek ?? snapshot.currentTime
        const playing = wantsPlay
        const next = { id: source.id, url: source.fallbackUrl }
        seek.request(position, true)
        // Preserve intent before the ordinary error path clears it. load()
        // invalidates old promises/events and reconciles the pending seek.
        metadataRetries = 0
        load(next, playing)
        return
      }
      stopMetadataTimer()
      stopDurationTimer()
      audio.setPreload('metadata')
      generation++
      endArmed = false
      cancelPlay()
      seek.reset()
      set('error')
      if (!snapshot.paused) audio.pause()
      return
    }
    if (hasMetadata(snapshot)) {
      stopMetadataTimer()
      stopDurationTimer()
      // Limit background loading only while stopped; preserve playback read-ahead.
      audio.setPreload(snapshot.paused || snapshot.ended ? 'metadata' : 'auto')
      if (!reconciling) {
        reconciling = true
        seek.reconcile(snapshot, event)
        reconciling = false
        if (deferredPlay && seek.snapshot().pendingSeek === null) requestPlay()
      }
    } else {
      // The native backend can finish calculating duration after its final
      // readiness event. Recheck that value without resetting the download.
      if (snapshot.readyState >= 1 && !snapshot.ended) watchDuration()
      else stopDurationTimer()
      if (!snapshot.paused || snapshot.ended) stopMetadataTimer()
      else if (event === 'progress' && status === 'loading') watchMetadata()
    }
    if (snapshot.ended) {
      cancelPlay()
      set('ended')
      return
    }
    if (event === 'pause' && snapshot.paused) {
      if (!resetPause) {
        endArmed = false
        cancelPlay()
      }
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
      // Once a run has already emitted playback events, a subsequent native
      // play event is a fresh request. WebKit may leave the earlier promise open.
      const nativeRestart = event === 'play' && playObservedSinceLoad
      if (pendingPlays.size && !wantsPlay && !nativeRestart) {
        audio.pause()
        return
      }
      wantsPlay = true
      playObservedSinceLoad = true
      gesturePrepared = true
      if (event === 'playing' && snapshot.readyState >= 3) {
        endArmed = true
        playedSinceLoad = true
      }
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
    if (event === 'timeupdate') {
      const previousTime = playbackTime
      playbackTime =
        wantsPlay &&
        !snapshot.paused &&
        !snapshot.seeking &&
        snapshot.readyState >= 2 &&
        Number.isFinite(snapshot.currentTime)
          ? snapshot.currentTime
          : null
      // WebKit can resume its clock after a seek or pause without another
      // playing event. Require consecutive advancing updates from a source
      // that has played; a seek jump or an unchanged clock is not playback.
      if (
        status === 'buffering' &&
        playedSinceLoad &&
        previousTime !== null &&
        playbackTime !== null &&
        playbackTime > previousTime
      ) {
        endArmed = true
        set('playing')
      }
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
      'timeupdate',
      'seeking',
      'seeked',
      'volumechange',
    ] as const
  ).map((event) =>
    audio.subscribe(event, () => {
      const actual = current()
      if (!actual) return
      const sourceResetPause =
        event === 'pause' &&
        (!actual.paused || (resetPausePending && !playObservedSinceLoad))
      observe(event)
      // A source-reset pause is not fresh listener activity.
      publish(sourceResetPause ? undefined : event)
      if (event === 'ended' && current()?.ended && endArmed && source) {
        endArmed = false
        eligibleEnd(source.id)
      }
    }),
  )
  function load(next: PlayerSource, continuePlaying: boolean) {
    stopDurationTimer()
    playbackTime = null
    endArmed = false
    playedSinceLoad = false
    generation++
    // Only unresolved requests from this source can guard its native events.
    pendingPlays.clear()
    intent++
    // A metadata-only retry must keep a queued Play cancellable in the UI.
    wantsPlay = continuePlaying || deferredPlay
    resetPausePending = resetPausePending || !audio.snapshot().paused
    playObservedSinceLoad = false
    seek.reset(true)
    source = next
    set('loading')
    // Fetch through large MP3 tags before reducing background buffering.
    audio.setPreload('auto')
    audio.load(next.url)
    watchMetadata()
    if (continuePlaying) {
      requestPlay()
    }
    publish()
  }
  return {
    snapshot,
    preparePlay() {
      if (
        disposed ||
        !source ||
        gesturePrepared ||
        !audio.requiresGesturePreparation
      )
        return
      gesturePrepared = true
      // Already-playing media has permission. Otherwise load synchronously in
      // the tap without playing the old episode, preserving any paused seek.
      if (wantsPlay) return
      const pending = seek.snapshot().pendingSeek
      const position =
        pending ?? (current()?.ended ? 0 : snapshot().currentTime)
      if (pending === null && position > 0) seek.request(position, true)
      metadataRetries = 0
      load(source, false)
    },
    select(next: PlayerSource | null, options: PlayerSelection = {}) {
      if (next?.fallbackUrl && failedSources.has(next.url))
        next = { id: next.id, url: next.fallbackUrl }
      if (disposed || (next?.id === source?.id && next?.url === source?.url))
        return
      if (options.paused) cancelPlay()
      seek.reset()
      if (!next) {
        stopMetadataTimer()
        stopDurationTimer()
        source = null
        generation++
        cancelPlay()
        audio.setPreload('metadata')
        audio.pause()
        set('idle')
        return
      }
      const snapshot = audio.snapshot()
      metadataRetries = 0
      if (options.position !== undefined)
        seek.request(
          options.position,
          options.positionReason === 'shared' ? 'shared' : true,
        )
      load(
        next,
        Boolean(
          !options.paused &&
          source &&
          !snapshot.error &&
          !snapshot.ended &&
          (deferredPlay || !snapshot.paused),
        ),
      )
    },
    play() {
      if (disposed || !source || status === 'error' || wantsPlay) return
      const actual = current()
      if (actual?.ended) {
        seek.request(0)
        seek.reconcile(actual)
      }
      requestPlay()
    },
    pause() {
      if (disposed) return
      endArmed = false
      cancelPlay()
      audio.pause()
      publish('pause')
    },
    seek(seconds: number, reason?: 'shared') {
      if (
        disposed ||
        !source ||
        status === 'error' ||
        !Number.isFinite(seconds)
      )
        return
      playbackTime = null
      seek.request(seconds, reason === 'shared' ? 'shared' : false)
      const actual = current()
      if (actual) seek.reconcile(actual)
      publish()
    },
    skip(seconds: number) {
      if (disposed) return
      const state = snapshot()
      if (state.duration === null) return
      const base = Math.min(
        state.duration,
        state.pendingSeek ?? state.currentTime,
      )
      this.seek(Math.min(state.duration, Math.max(0, base + seconds)))
    },
    setVolume(value: number) {
      if (disposed) return
      volume.setVolume(value)
      publish()
    },
    toggleMute() {
      if (disposed) return
      volume.toggleMute()
      publish()
    },
    retry() {
      if (disposed || !source) return
      cancelPlay()
      seek.reset()
      audio.pause()
      metadataRetries = 0
      load(source, false)
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopMetadataTimer()
      stopDurationTimer()
      generation++
      endArmed = false
      cancelPlay()
      seek.reset()
      for (const stop of unsubscribe) stop()
      audio.dispose()
    },
  }
}
