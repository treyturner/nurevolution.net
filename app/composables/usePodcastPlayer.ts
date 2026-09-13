import type { ComponentPublicInstance } from 'vue'
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
    attached: false,
    restoring: false,
    restoreMessage: null,
  })
  let element: HTMLAudioElement | null = null
  let controller: ReturnType<typeof createPlayer> | undefined
  let storage: ReturnType<typeof createPlaybackStorage> | undefined
  let bootstrapped = false
  let disposed = false
  let suspended = false
  let savedId: string | null = null
  let initialWrite = false
  let resetting = false
  let pendingResetPauses = 0
  let suppressPauseCapture = false
  const cleanups: (() => void)[] = []
  function capture(snapshot: PlayerSnapshot, event?: AudioEvent) {
    if (
      !storage ||
      !bootstrapped ||
      suspended ||
      resetting ||
      suppressPauseCapture ||
      !snapshot.sourceId ||
      snapshot.pendingSeek !== null ||
      snapshot.status === 'error' ||
      snapshot.sourceId !== episode()?.id
    )
      return
    const selected = snapshot.sourceId !== savedId
    if (
      selected ||
      initialWrite ||
      event === 'seeked' ||
      event === 'pause' ||
      event === 'ended'
    ) {
      savedId = snapshot.sourceId
      initialWrite = false
      storage.capture(snapshot.sourceId, snapshot.currentTime, true)
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
        capture(snapshot, event)
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
    // A deliberate route selection is activity even when it selects the same
    // source after a failed root restore. Keep its existing playback position.
    initialWrite = true
    select()
    capture(controller!.snapshot())
  })
  onBeforeUnmount(() => {
    disposed = true
    storage?.flush()
    suspended = true
    for (const stop of cleanups) stop()
    controller?.dispose()
  })
  return {
    state: readonly(state),
    bindAudio(value: Element | ComponentPublicInstance | null) {
      element = value as HTMLAudioElement | null
    },
    retry() {
      if (!controller || !state.sourceId) return
      if (element && !element.paused) pendingResetPauses++
      resetting = true
      try {
        controller.retry()
      } finally {
        resetting = false
      }
      state.restoreMessage = null
      initialWrite = true
      capture(controller.snapshot())
    },
    play: () => controller?.play(),
    pause: () => controller?.pause(),
    seek: (seconds: number) => controller?.seek(seconds),
    skip: (seconds: number) => controller?.skip(seconds),
    setVolume: (value: number) => controller?.setVolume(value),
    toggleMute: () => controller?.toggleMute(),
  }
}
export type PodcastPlayer = ReturnType<typeof usePodcastPlayer>
