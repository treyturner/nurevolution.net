import { createEpisodeSequencer } from '../services/episode-sequencing'
import type { ComponentPublicInstance } from 'vue'
import { trackNavigation } from '../services/track-navigation'
import { createAudioAdapter, type AudioEvent } from '../services/audio'
import { createPlayer, type PlayerSnapshot } from '../services/player'
import {
  createPlaybackStorage,
  type ResumeRecord,
} from '../services/playback-storage'
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
    restoring: false,
    restoreMessage: null,
  })
  let element: HTMLAudioElement | null = null
  let controller: ReturnType<typeof createPlayer> | undefined
  let storage: ReturnType<typeof createPlaybackStorage> | undefined
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
  const cleanups: (() => void)[] = []
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
  function select(saved?: ResumeRecord | null) {
    const current = episode()
    controller?.select(
      current
        ? {
            id: current.id,
            url: deliveryAssetUrl(
              current.audio.url,
              'audio',
              config.public.mediaOrigin,
            ),
          }
        : null,
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
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') storage?.flush()
    })
    listen(window, 'pagehide', () => {
      storage?.flush()
      suspended = true
      pauseForLifecycle()
    })
    listen(window, 'pageshow', (event) => {
      if (!(event as PageTransitionEvent).persisted) return
      pauseForLifecycle()
      suspended = false
      storage?.visit(false)
    })
    void initialize()
  })
  watch(episode, () => {
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
    sequence.dispose()
    storage?.flush()
    suspended = true
    for (const stop of cleanups) stop()
    controller?.dispose()
  })
  const tracks = computed(() =>
    trackNavigation(
      episode()?.tracks ?? [],
      state.pendingSeek ?? state.currentTime,
      state.duration,
    ),
  )
  const currentTrack = computed(
    () =>
      trackNavigation(
        episode()?.tracks ?? [],
        state.currentTime,
        state.duration,
      ).current,
  )
  return {
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
      if (target?.startTime !== null && target?.startTime !== undefined)
        controller?.seek(target.startTime)
    },
    previousTrack() {
      if (tracks.value.previous !== null)
        controller?.seek(tracks.value.previous)
    },
    nextTrack() {
      if (tracks.value.next !== null) controller?.seek(tracks.value.next)
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
    seek: (seconds: number) => controller?.seek(seconds),
    skip: (seconds: number) => controller?.skip(seconds),
    setVolume: (value: number) => controller?.setVolume(value),
    toggleMute: () => controller?.toggleMute(),
  }
}
export type PodcastPlayer = ReturnType<typeof usePodcastPlayer>
