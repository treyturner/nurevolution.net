import {
  episodeNeighbor,
  type EpisodeDirection,
  type EpisodeMoveResult,
} from '../services/episode-sequencing'
import type { EpisodeSummary } from '../../shared/content/public'
export type RestoreResult = 'restored' | 'missing' | 'failed' | 'cancelled'

export function useEpisodePlaybackNavigation() {
  const nuxt = useNuxtApp()
  const state = useEpisodePage()
  const router = useRouter()
  let stopMove: (() => void) | undefined
  let stopSelectionWait: (() => void) | undefined
  onBeforeUnmount(() => {
    stopMove?.()
    stopSelectionWait?.()
  })
  function navigate(path: string, replace: boolean): Promise<RestoreResult> {
    return new Promise((resolve) => {
      let token: number | undefined
      let settled = false
      const done = (result: RestoreResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsubscribe()
        stopMove = undefined
        resolve(result)
      }
      const unsubscribe = nuxt.$episodeNavigation.onPrepare(
        (nextPath, next) => {
          if (token === undefined && nextPath === path) token = next
          else done('cancelled')
        },
      )
      const timer = setTimeout(() => {
        if (token !== undefined) nuxt.$episodeNavigation.cancel(token)
        done('failed')
      }, 5000)
      stopMove = () => {
        if (token !== undefined) nuxt.$episodeNavigation.cancel(token)
        done('cancelled')
      }
      void (replace ? router.replace(path) : router.push(path)).then(
        (failure) => done(failure ? 'failed' : 'restored'),
        () => done('failed'),
      )
    })
  }
  return {
    isRoot: () => router.currentRoute.value.path === '/',
    waitForSelection(): Promise<boolean> {
      if (!state.value.pendingPath)
        return Promise.resolve(!state.value.failedPath)
      return new Promise((resolve) => {
        const stop = watch(
          () => state.value.pendingPath,
          (pending) => {
            if (pending) return
            stop()
            stopSelectionWait = undefined
            resolve(!state.value.failedPath)
          },
        )
        stopSelectionWait = () => {
          stop()
          resolve(false)
        }
      })
    },
    get pending() {
      return state.value.pendingPath !== null
    },
    neighbor: (direction: EpisodeDirection) =>
      episodeNeighbor(
        state.value.model?.episodes ?? [],
        state.value.model?.selected?.id ?? null,
        direction,
      ),
    async move(
      target: EpisodeSummary,
      replace: boolean,
    ): Promise<EpisodeMoveResult> {
      const result = await navigate(target.path, replace)
      return result === 'restored'
        ? 'committed'
        : result === 'cancelled'
          ? 'cancelled'
          : 'failed'
    },
    async restore(episodeId: string): Promise<RestoreResult> {
      const target = state.value.model?.episodes.find((e) => e.id === episodeId)
      return target ? navigate(target.path, true) : 'missing'
    },
  }
}
