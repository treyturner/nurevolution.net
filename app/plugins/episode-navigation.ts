import {
  createEpisodeNavigation,
  loadEpisodePage,
} from '../services/episode-page'

export default defineNuxtPlugin((nuxt) => {
  const state = useEpisodePage()
  const navigation = createEpisodeNavigation(
    state.value,
    (path, slug, signal) =>
      nuxt.runWithContext(async () => {
        // H3 decodes escaped delimiters before routing; inspect the original SSR path.
        const requestedPath = import.meta.server
          ? useRequestURL().pathname
          : path
        if (/%(?:23|3f)/i.test(requestedPath))
          throw createError({
            statusCode: 404,
            statusMessage: 'Episode not found',
          })
        const read = () =>
          loadEpisodePage(
            {
              show: () => $fetch('/api/show', { signal }),
              list: () => $fetch('/api/episodes', { signal }),
              detail: (savedSlug) =>
                $fetch(`/api/episodes/${encodeURIComponent(savedSlug)}`, {
                  signal,
                }),
            },
            slug,
          )
        // A keyed async-data handler can retain an aborted signal when revisiting
        // its path. Client navigations need a fresh request-scoped reader.
        if (import.meta.client) return read()
        const task = useAsyncData(`episode-page:${path}`, read, {
          deep: false,
          immediate: false,
          getCachedData: () => undefined,
        })
        await task.execute({ dedupe: 'cancel' })
        if (task.error.value) throw task.error.value
        return task.data.value!
      }),
  )
  nuxt.$router.afterEach((to, _from, failure) =>
    navigation.complete(
      to.path,
      typeof to.meta.episodeNavigationToken === 'number'
        ? to.meta.episodeNavigationToken
        : undefined,
      Boolean(failure),
    ),
  )
  return { provide: { episodeNavigation: navigation } }
})
