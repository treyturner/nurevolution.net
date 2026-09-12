import type {
  EpisodeDetail,
  EpisodeSummary,
  PublicShow,
} from '../../shared/content/public'

export interface EpisodePage {
  show: PublicShow
  episodes: EpisodeSummary[]
  selected: EpisodeDetail | null
}

export interface EpisodePageState {
  model: EpisodePage | null
  path: string
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
  load: (path: string, slug?: string) => Promise<EpisodePage>,
) {
  let generation = 0
  let staged: { path: string; model: EpisodePage } | undefined
  return {
    async prepare(path: string, slug?: string) {
      const own = ++generation
      staged = undefined
      state.pendingPath = path
      state.failedPath = null
      try {
        const model = await load(path, slug)
        if (own !== generation) return false
        staged = { path, model }
        return own
      } catch (error) {
        if (own !== generation) return false
        state.pendingPath = null
        state.failedPath = path
        throw error
      }
    },
    complete(path: string, token: number | undefined, failed = false) {
      if (staged?.path !== path || token !== generation) return
      if (!failed) {
        state.model = staged.model
        state.path = path
      }
      staged = undefined
      state.pendingPath = null
    },
  }
}

export function episodeHead(model: EpisodePage, path: string) {
  const episode = model.selected
  return {
    title:
      path === '/' || !episode
        ? 'Nurevolution — Podcast archive'
        : `${episode.artist} — ${episode.title} | Nurevolution`,
    meta: [
      {
        name: 'description',
        content: episode
          ? `Listen to ${episode.artist} — ${episode.title}. Episode audio, artwork, and tracklist from Nurevolution.`
          : model.show.descriptionText,
      },
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
        href: model.show.feedUrl,
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
