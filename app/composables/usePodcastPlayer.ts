import { createEpisodeSequencer } from '../services/episode-sequencing'
import type { ComponentPublicInstance } from 'vue'
import { trackNavigation } from '../services/track-navigation'
import { createTrackClock } from '../services/track-clock'
import { createAudioAdapter, type AudioEvent } from '../services/audio'
import { createPlayer, type PlayerSnapshot } from '../services/player'
import {
  createPlaybackStorage,
  type ResumeRecord,
} from '../services/playback-storage'
import { playerSource } from '../services/playback-source'
import { createMediaSession } from '../services/media-session'
import { deliveryAssetUrl } from '../services/delivery-assets'
import type { EpisodeDetail } from '../../shared/content/public'
import type { useEpisodePlaybackNavigation } from './useEpisodePlaybackNavigation'

export function usePodcastPlayer(
  episode: () => EpisodeDetail | null,
  navigation?: ReturnType<typeof useEpisodePlaybackNavigation>,
) {
  const config = useRuntimeConfig()
  const state = shallowReactive<
    PlayerSnapshot & {
      continuing: boolean
      attached: boolean
      initialized: boolean
      restoring: boolean
      restoreMessage: string | null
    }
  >({
    sourceId: null,
    status: 'idle',
    wantsPlay: false,
    currentTime: 0,
    duration: null,
    seeking: false,
    pendingSeek: null,
    seekMessage: null,
    volume: 1,
    muted: false,
    volumeSupported: false,
    muteSupported: false,
    continuing: false,
    attached: false,
    initialized: false,
    restoring: false,
    restoreMessage: null,
  })
  let element: HTMLAudioElement | null = null
  let controller: ReturnType<typeof createPlayer> | undefined
  let storage: ReturnType<typeof createPlaybackStorage> | undefined
  let mediaSession: ReturnType<typeof createMediaSession> | undefined
  let bootstrapped = false
  let playbackStarted = false
  let disposed = false
  let suspended = false
  let savedId: string | null = null
  let initialWrite = false
  let resetting = false
  let pendingResetPauses = 0
  let suppressPauseCapture = false
  let pendingPauseAt: number | null = null
  const trackClock = createTrackClock()
  const trackTime = ref(0)
  const cleanups: (() => void)[] = []
  const invalidTimestampMessage = 'Invalid timestamp; starting at 0:00.'
  function clearTimestampMessage() {
    if (state.restoreMessage === invalidTimestampMessage)
      state.restoreMessage = null
  }
  const sequenceRevision = ref(0)
  const sequence = createEpisodeSequencer(
    {
      neighbor: (direction) => navigation?.neighbor(direction) ?? null,
      currentId: () => episode()?.id ?? null,
      pending: () => navigation?.pending ?? false,
      navigate: (target, replace) => navigation!.move(target, replace),
      restart: () => controller?.seek(0),
      play: () => controller?.play(),
    },
    () => {
      sequenceRevision.value++
      state.continuing = sequence.snapshot().continuing
    },
  )
  function capture(
    snapshot: PlayerSnapshot,
    event?: AudioEvent,
    explicitActivity = false,
  ) {
    if (
      !storage ||
      !bootstrapped ||
      suspended ||
      resetting ||
      (suppressPauseCapture && !explicitActivity) ||
      !snapshot.sourceId ||
      snapshot.status === 'error' ||
      snapshot.sourceId !== episode()?.id
    )
      return
    if (snapshot.wantsPlay) pendingPauseAt = null
    else if (event === 'pause') pendingPauseAt = Date.now()
    if (snapshot.pendingSeek !== null) return
    const selected = snapshot.sourceId !== savedId
    if (
      selected ||
      initialWrite ||
      pendingPauseAt !== null ||
      event === 'seeked' ||
      event === 'pause' ||
      event === 'ended'
    ) {
      const activityAt = event === 'seeked' ? Date.now() : pendingPauseAt
      pendingPauseAt = null
      savedId = snapshot.sourceId
      initialWrite = false
      storage.capture(
        snapshot.sourceId,
        snapshot.currentTime,
        true,
        activityAt ?? Date.now(),
      )
    } else if (event === 'timeupdate' && snapshot.wantsPlay) {
      storage.capture(snapshot.sourceId, snapshot.currentTime)
    }
  }
  function updateMediaSession(forcePosition = false) {
    // Route acceptance precedes the controller's source change. Keep the old
    // metadata until both identities agree, including synchronous reset events.
    if (state.sourceId === (episode()?.id ?? null))
      mediaSession?.update(forcePosition)
  }
  function select(saved?: ResumeRecord | null) {
    const current = episode()
    const source = current
      ? playerSource(
          current,
          config.public.mediaOrigin,
          navigator.userAgent,
          (type) => element?.canPlayType(type) ?? '',
          window.location.href,
        )
      : null
    const timestamp = navigation?.timestamp
    if (source && timestamp && timestamp.kind !== 'none') {
      const target = timestamp.kind === 'time' ? timestamp.seconds : 0
      state.restoreMessage =
        timestamp.kind === 'invalid' ? invalidTimestampMessage : null
      sequence.pause()
      if (element && !element.paused) pendingResetPauses++
      resetting = true
      try {
        controller?.pause()
        controller?.select(source, {
          position: target,
          paused: true,
          positionReason: 'shared',
        })
        // Same-source selects are intentionally idempotent; query links still seek.
        trackClock.reset()
        controller?.seek(target, 'shared')
      } finally {
        resetting = false
      }
      return
    }
    controller?.select(
      source,
      saved?.episodeId === current?.id && saved
        ? { position: saved.positionSeconds, paused: true }
        : {},
    )
  }
  async function initialize() {
    if (disposed) return
    if ('prerendering' in document && document.prerendering) {
      listen(document, 'prerenderingchange', initialize, { once: true })
      return
    }
    // Consume the native reset/teardown event even if the controller rejects it as
    // belonging to an older source. Capture phase runs before media observers.
    listen(
      element!,
      'pause',
      () => {
        if (!pendingResetPauses) return
        pendingResetPauses--
        suppressPauseCapture = true
        queueMicrotask(() => {
          suppressPauseCapture = false
        })
      },
      { capture: true },
    )
    // Browser globals and storage are touched only by the mounted owner.
    controller = createPlayer(
      createAudioAdapter(element!),
      () => {},
      (snapshot, event) => {
        Object.assign(state, snapshot)
        trackTime.value = trackClock(snapshot, event)
        updateMediaSession(
          event === 'seeked' ||
            event === 'play' ||
            event === 'pause' ||
            event === 'ended',
        )
        if (snapshot.wantsPlay) clearTimestampMessage()
        if (snapshot.status === 'playing') playbackStarted = true
        if (
          sequence.snapshot().continuing &&
          (snapshot.status === 'error' || snapshot.status === 'blocked')
        )
          sequence.pause()
        capture(snapshot, event)
      },
      () => {
        void sequence.ended()
      },
    )
    state.attached = true
    // The application is running even while a saved selection awaits its request.
    state.initialized = true
    document.dispatchEvent(new Event('nurevolution:player-ready'))
    storage = navigation
      ? createPlaybackStorage(() => window.localStorage)
      : undefined
    let saved = storage?.visit()
    if (saved && navigation?.isRoot()) {
      state.restoring = true
      let result = await navigation.restore(saved.episodeId)
      if (disposed) return
      if (result === 'cancelled') {
        // The accepted model still belongs to root until the newer request
        // commits. Do not load or persist that fallback while it is pending.
        const accepted = await navigation.waitForSelection()
        if (disposed) return
        if (!accepted) result = 'failed'
      }
      state.restoring = false
      if (result !== 'restored') saved = null
      if (result === 'missing') storage?.discard()
      if (result === 'failed')
        state.restoreMessage = 'Saved episode could not be restored.'
    }
    select(saved)
    bootstrapped = true
    initialWrite = !state.restoreMessage
    savedId = state.restoreMessage ? state.sourceId : null
    capture(controller.snapshot())
  }
  function listen(
    target: EventTarget,
    event: string,
    callback: EventListener,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(event, callback, options)
    cleanups.push(() => target.removeEventListener(event, callback, options))
  }
  function pauseForLifecycle() {
    sequence.pause()
    if (controller && element && !element.paused) pendingResetPauses++
    controller?.pause()
  }
  onMounted(() => {
    // Optional platform APIs are accessed only by the mounted player owner.
    try {
      mediaSession = createMediaSession(
        navigator.mediaSession,
        typeof MediaMetadata === 'function'
          ? (data) => new MediaMetadata(data)
          : undefined,
        {
          snapshot: () => ({
            ...state,
            episode: episode(),
            showTitle: navigation?.showTitle ?? '',
            artworkUrl: deliveryAssetUrl(
              episode()?.artworkUrl ?? '',
              'artwork',
              config.public.webOrigin,
            ),
            busy:
              !state.initialized ||
              state.restoring ||
              Boolean(navigation?.pending) ||
              sequence.snapshot().busy,
            track: currentTrack.value,
            previous: tracks.value.previous,
            next: tracks.value.next,
          }),
          play: () => player.play(),
          pause: () => player.pause(),
          seek: (seconds) => player.seek(seconds),
          skip: (seconds) => player.skip(seconds),
          previousTrack: () => player.previousTrack(),
          nextTrack: () => player.nextTrack(),
        },
      )
    } catch {
      // Some engines expose an API property that cannot be read in this context.
    }
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') storage?.flush()
    })
    listen(window, 'pagehide', () => {
      storage?.flush()
      suspended = true
      pauseForLifecycle()
      mediaSession?.suspend()
    })
    listen(window, 'pageshow', (event) => {
      if (!(event as PageTransitionEvent).persisted) return
      pauseForLifecycle()
      suspended = false
      storage?.visit(false)
      mediaSession?.resume()
    })
    void initialize()
  })
  watch(
    [
      episode,
      () => state.initialized,
      () => state.restoring,
      () => navigation?.pending,
      sequenceRevision,
    ],
    () => updateMediaSession(),
  )
  watch(
    () => navigation?.pending,
    (pending) => {
      if (pending) clearTimestampMessage()
    },
  )
  watch([episode, () => navigation?.timestamp], () => {
    if (!bootstrapped) return
    state.restoreMessage = null
    pendingPauseAt = null
    // A deliberate route selection is activity even when it selects the same
    // source after a failed root restore. Keep its existing playback position.
    initialWrite = true
    sequence.selected()
    select()
    capture(controller!.snapshot())
  })
  onBeforeUnmount(() => {
    disposed = true
    mediaSession?.dispose()
    sequence.dispose()
    storage?.flush()
    suspended = true
    for (const stop of cleanups) stop()
    controller?.dispose()
  })
  const tracks = computed(() =>
    trackNavigation(
      episode()?.tracks ?? [],
      state.pendingSeek ?? trackTime.value,
      state.duration,
    ),
  )
  const currentTrack = computed(
    () =>
      trackNavigation(episode()?.tracks ?? [], trackTime.value, state.duration)
        .current,
  )
  const player = {
    state: readonly(state),
    get sequencing() {
      void sequenceRevision.value
      return sequence.snapshot()
    },
    previousEpisode: () => sequence.manual('previous'),
    nextEpisode: () => sequence.manual('next'),
    get sortOrder() {
      return navigation?.sortOrder ?? 'newest-first'
    },
    async toggleSort() {
      if (
        !navigation ||
        !bootstrapped ||
        state.restoring ||
        sequence.snapshot().busy ||
        navigation.episodes.length < 2
      )
        return
      const selectFirst =
        navigation.episodes[0]?.id === episode()?.id &&
        !playbackStarted &&
        !state.wantsPlay
      navigation.toggleSort()
      // The unplayed first episode is now last; Next wraps to the new first.
      if (selectFirst) await sequence.manual('next')
    },
    get tracks() {
      return { ...tracks.value, current: currentTrack.value }
    },
    seekTrack(position: number) {
      if (!tracks.value.positions.includes(position)) return
      const target = episode()?.tracks.find(
        (track) => track.position === position,
      )
      if (target?.startTime !== null && target?.startTime !== undefined) {
        trackClock.reset()
        clearTimestampMessage()
        controller?.seek(target.startTime)
      }
    },
    previousTrack() {
      if (tracks.value.previous !== null) {
        trackClock.reset()
        clearTimestampMessage()
        controller?.seek(tracks.value.previous)
      }
    },
    nextTrack() {
      if (tracks.value.next !== null) {
        trackClock.reset()
        clearTimestampMessage()
        controller?.seek(tracks.value.next)
      }
    },
    bindAudio(value: Element | ComponentPublicInstance | null) {
      element = value as HTMLAudioElement | null
    },
    retry() {
      if (!controller || !state.sourceId) return
      pendingPauseAt = null
      sequence.pause()
      if (element && !element.paused) pendingResetPauses++
      resetting = true
      try {
        controller.retry()
      } finally {
        resetting = false
      }
      state.restoreMessage = null
      initialWrite = true
      capture(controller.snapshot(), undefined, true)
    },
    play: () => controller?.play(),
    pause() {
      sequence.pause()
      if (!controller) return
      if (element && !element.paused) pendingResetPauses++
      resetting = true
      try {
        controller.pause()
      } finally {
        resetting = false
      }
      // Save the command once; its queued native pause is not new activity.
      capture(controller.snapshot(), 'pause', true)
    },
    seek(seconds: number) {
      trackClock.reset()
      clearTimestampMessage()
      controller?.seek(seconds)
    },
    skip(seconds: number) {
      trackClock.reset()
      clearTimestampMessage()
      controller?.skip(seconds)
    },
    setVolume: (value: number) => controller?.setVolume(value),
    toggleMute: () => controller?.toggleMute(),
  }
  return player
}
export type PodcastPlayer = ReturnType<typeof usePodcastPlayer>
