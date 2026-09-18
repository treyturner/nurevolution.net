import type { EpisodeDetail } from '../../shared/content/public'
import type { PlayerSnapshot } from './player'

export type MediaSessionPort = Pick<
  MediaSession,
  'metadata' | 'playbackState' | 'setActionHandler'
> &
  Partial<Pick<MediaSession, 'setPositionState'>>

export interface MediaSessionSnapshot extends PlayerSnapshot {
  episode: EpisodeDetail | null
  showTitle: string
  artworkUrl: string
  busy: boolean
  track: number | null
  previous: number | null
  next: number | null
}

export interface MediaSessionHost {
  snapshot(): MediaSessionSnapshot
  play(): void
  pause(): void
  seek(seconds: number): void
  skip(seconds: number): void
  previousTrack(): void
  nextTrack(): void
}

const actions = [
  'play',
  'pause',
  'stop',
  'seekbackward',
  'seekforward',
  'seekto',
  'previoustrack',
  'nexttrack',
] as const
type Action = (typeof actions)[number]

/** Optional system controls that always act through the current player owner. */
export function createMediaSession(
  session: MediaSessionPort | undefined,
  metadata: ((value: MediaMetadataInit) => MediaMetadata) | undefined,
  host: MediaSessionHost,
  now: () => number = Date.now,
) {
  let disposed = false
  let suspended = false
  let source: string | null = null
  let established = false
  let metadataKey: string | undefined
  let playback: MediaSessionPlaybackState | undefined
  let duration: number | null = null
  let positionAt = -Infinity
  const registered = new Map<Action, boolean>()
  function attempt(write: () => void) {
    try {
      write()
    } catch {
      // Support varies per property/action; one failure must not disable audio.
    }
  }
  function selected(state: MediaSessionSnapshot) {
    return state.sourceId !== null && state.episode?.id === state.sourceId
  }
  function available(action: Action, state: MediaSessionSnapshot) {
    if (action === 'pause' || action === 'stop') return state.sourceId !== null
    if (!selected(state) || state.busy || state.status === 'error') return false
    if (action === 'play') return true
    if (action === 'previoustrack') return state.previous !== null
    if (action === 'nexttrack') return state.next !== null
    return (
      state.duration !== null &&
      Number.isFinite(state.duration) &&
      state.duration > 0
    )
  }
  function invoke(action: Action, details: MediaSessionActionDetails) {
    if (disposed || suspended || !available(action, host.snapshot())) return
    if (action === 'play') host.play()
    else if (action === 'pause' || action === 'stop') host.pause()
    else if (action === 'previoustrack') host.previousTrack()
    else if (action === 'nexttrack') host.nextTrack()
    else if (action === 'seekto') {
      if (Number.isFinite(details.seekTime)) host.seek(details.seekTime!)
    } else {
      const offset = details.seekOffset
      const seconds =
        offset !== undefined && Number.isFinite(offset) && offset > 0
          ? offset
          : 30
      host.skip(action === 'seekbackward' ? -seconds : seconds)
    }
  }
  function clear() {
    if (!session) return
    for (const action of actions)
      attempt(() => session.setActionHandler(action, null))
    attempt(() => {
      session.metadata = null
    })
    attempt(() => {
      session.playbackState = 'none'
    })
    attempt(() => session.setPositionState?.())
    registered.clear()
    metadataKey = playback = undefined
    source = duration = null
    positionAt = -Infinity
    established = false
  }
  function update(force = false) {
    if (!session || disposed || suspended) return
    const state = host.snapshot()
    const hasSelection = selected(state)
    const episode = hasSelection ? state.episode : null
    if (source !== state.sourceId) {
      source = state.sourceId
      established = false
      duration = null
      positionAt = -Infinity
      attempt(() => session.setPositionState?.())
      force = true
    }
    for (const action of actions) {
      const enabled = available(action, state)
      if (registered.get(action) === enabled) continue
      attempt(() =>
        session.setActionHandler(
          action,
          enabled ? (details) => invoke(action, details) : null,
        ),
      )
      registered.set(action, enabled)
    }
    const track = episode?.tracks.find((item) => item.position === state.track)
    const data: MediaMetadataInit | null = episode
      ? {
          title: track?.title ?? episode.title,
          artist: track?.artist ?? episode.artist,
          album: track
            ? `${episode.artist} - ${episode.title}`
            : state.showTitle,
          artwork: state.artworkUrl ? [{ src: state.artworkUrl }] : [],
        }
      : null
    const key = JSON.stringify(data)
    if (metadataKey !== key) {
      try {
        // Replace directly so the OS cannot display generic page metadata
        // between tracks. Clear stale identity only if replacement fails.
        session.metadata = data && metadata ? metadata(data) : null
      } catch {
        attempt(() => {
          session.metadata = null
        })
      }
      metadataKey = key
    }
    if (state.status === 'playing' && state.wantsPlay) established = true
    else if (!state.wantsPlay || state.status !== 'buffering')
      established = false
    const nextPlayback = !state.sourceId
      ? 'none'
      : established
        ? 'playing'
        : 'paused'
    if (playback !== nextPlayback) {
      attempt(() => {
        session.playbackState = nextPlayback
      })
      playback = nextPlayback
      force = true
    }
    const validPosition =
      hasSelection &&
      state.duration !== null &&
      Number.isFinite(state.duration) &&
      state.duration > 0 &&
      Number.isFinite(state.currentTime)
    if (!validPosition) {
      if (duration !== null || positionAt === -Infinity)
        attempt(() => session.setPositionState?.())
      duration = null
      positionAt = now()
      return
    }
    // A seek's optimistic clock/target is not a confirmed system timeline.
    if (state.pendingSeek !== null || state.seeking) return
    const time = now()
    if (force || duration !== state.duration || time - positionAt >= 1000) {
      attempt(() =>
        session.setPositionState?.({
          duration: state.duration!,
          playbackRate: 1,
          position: Math.max(0, Math.min(state.duration!, state.currentTime)),
        }),
      )
      duration = state.duration
      positionAt = time
    }
  }
  return {
    update,
    suspend() {
      if (disposed || suspended) return
      suspended = true
      clear()
    },
    resume() {
      if (disposed) return
      suspended = false
      update(true)
    },
    dispose() {
      if (disposed) return
      disposed = true
      clear()
    },
  }
}
