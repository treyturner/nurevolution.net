import type {
  EpisodeDetail,
  EpisodeSummary,
  PublicShow,
} from '../../shared/content/public'
import {
  sameTimestamp,
  timestampKey,
  type TimestampIntent,
} from './timestamp-link'

export interface EpisodePage {
  show: PublicShow
  episodes: EpisodeSummary[]
  selected: EpisodeDetail | null
}

export interface EpisodePageState {
  model: EpisodePage | null
  path: string
  route: string
  timestamp: TimestampIntent
  pendingPath: string | null
  failedPath: string | null
}

export interface EpisodeReader {
  show(): Promise<PublicShow>
  list(): Promise<{ episodes: EpisodeSummary[] }>
  detail(slug: string): Promise<EpisodeDetail>
}

export async function loadEpisodePage(
  reader: EpisodeReader,
  slug?: string,
): Promise<EpisodePage> {
  const [show, { episodes }] = await Promise.all([reader.show(), reader.list()])
  const selectedSlug = slug ?? episodes[0]?.slug
  const selected = selectedSlug ? await reader.detail(selectedSlug) : null
  return { show, episodes, selected }
}

/** Stage independently of the displayed episode; only a successful route commits. */
export function createEpisodeNavigation(
  state: EpisodePageState,
  load: (
    path: string,
    slug?: string,
    signal?: AbortSignal,
  ) => Promise<EpisodePage>,
) {
  let generation = 0
  let controller: AbortController | undefined
  const guards = new Set<
    (path: string, slug?: string) => boolean | Promise<boolean>
  >()
  const preparing = new Set<(path: string, token: number) => void>()
  let staged:
    | {
        path: string
        route: string
        timestamp: TimestampIntent
        model: EpisodePage
      }
    | undefined
  return {
    onBeforePrepare(
      guard: (path: string, slug?: string) => boolean | Promise<boolean>,
    ) {
      guards.add(guard)
      return () => guards.delete(guard)
    },
    onPrepare(listener: (path: string, token: number) => void) {
      preparing.add(listener)
      return () => preparing.delete(listener)
    },
    cancel(token: number) {
      if (token !== generation) return
      generation++
      controller?.abort()
      staged = undefined
      state.pendingPath = null
      state.failedPath = null
    },
    async prepare(
      path: string,
      slug?: string,
      timestamp: TimestampIntent = { kind: 'none' },
      route = path,
    ) {
      const own = ++generation
      controller?.abort()
      staged = undefined
      state.failedPath = null
      for (const guard of guards) {
        let allowed = guard(path, slug)
        if (typeof allowed !== 'boolean') {
          state.pendingPath = null
          allowed = await allowed
        }
        if (own !== generation) return false
        if (!allowed) {
          state.pendingPath = null
          return false
        }
      }
      controller = new AbortController()
      state.pendingPath = path
      for (const listener of preparing) listener(path, own)
      try {
        const model =
          state.model && state.path === path
            ? state.model
            : await load(path, slug, controller.signal)
        if (own !== generation) return false
        staged = { path, route, timestamp, model }
        return own
      } catch (error) {
        if (own !== generation) return false
        state.pendingPath = null
        state.failedPath = route
        throw error
      }
    },
    complete(route: string, token: number | undefined, failed = false) {
      if (staged?.route !== route || token !== generation) return
      if (!failed) {
        if (
          state.path !== staged.path ||
          !sameTimestamp(state.timestamp, staged.timestamp) ||
          (staged.timestamp.kind !== 'none' &&
            timestampKey(state.route) !== timestampKey(staged.route))
        )
          state.timestamp = staged.timestamp
        state.model = staged.model
        state.path = staged.path
        state.route = route
      }
      staged = undefined
      state.pendingPath = null
    },
  }
}

export function episodeHead(model: EpisodePage, path: string) {
  const episode = model.selected
  const title = 'nurevolution studios'
  const description = episode
    ? `Listen to ${episode.artist} - ${episode.title}. Episode audio, artwork, and tracklist from nurevolution studios.`
    : model.show.descriptionText
  return {
    title,
    meta: [
      { name: 'description', content: description },
      { property: 'og:site_name', content: title },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
    ],
    link: [
      {
        rel: 'canonical',
        href: new URL(
          path === '/' || !episode ? path : episode.path,
          model.show.siteUrl,
        ).href,
      },
      {
        rel: 'alternate',
        type: 'application/rss+xml',
        title: model.show.title,
        href: '/feed/podcast',
      },
    ],
  }
}

export function formatTime(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0)
    return 'Duration unavailable'
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const tail = String(whole % 60).padStart(2, '0')
  return minutes < 60
    ? `${minutes}:${tail}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${tail}`
}

export function formatDate(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  const months = [
    'Jan.',
    'Feb.',
    'Mar.',
    'Apr.',
    'May',
    'June',
    'July',
    'Aug.',
    'Sept.',
    'Oct.',
    'Nov.',
    'Dec.',
  ]
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}
