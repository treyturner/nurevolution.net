export type RestoreResult = 'restored' | 'missing' | 'failed' | 'cancelled'

export function useEpisodePlaybackNavigation() {
  const nuxt = useNuxtApp()
  const state = useEpisodePage()
  const router = useRouter()
  let stopRestore: (() => void) | undefined
  onBeforeUnmount(() => stopRestore?.())
  return {
    isRoot: () => router.currentRoute.value.path === '/',
    async restore(episodeId: string): Promise<RestoreResult> {
      const target = state.value.model?.episodes.find((e) => e.id === episodeId)
      if (!target) return 'missing'
      return new Promise((resolve) => {
        let token: number | undefined
        let settled = false
        const done = (result: RestoreResult) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          unsubscribe()
          stopRestore = undefined
          resolve(result)
        }
        const unsubscribe = nuxt.$episodeNavigation.onPrepare((path, next) => {
          if (token === undefined && path === target.path) token = next
          else done('cancelled')
        })
        const timer = setTimeout(() => {
          if (token !== undefined) nuxt.$episodeNavigation.cancel(token)
          done('failed')
        }, 5000)
        stopRestore = () => {
          if (token !== undefined) nuxt.$episodeNavigation.cancel(token)
          done('cancelled')
        }
        void router.replace(target.path).then(
          (failure) => done(failure ? 'failed' : 'restored'),
          () => done('failed'),
        )
      })
    },
  }
}
