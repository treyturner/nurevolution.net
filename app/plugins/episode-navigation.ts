import {
  createEpisodeNavigation,
  loadEpisodePage,
} from '../services/episode-page'

export default defineNuxtPlugin((nuxt) => {
  const state = useEpisodePage()
  const navigation = createEpisodeNavigation(state.value, (path, slug) =>
    nuxt.runWithContext(async () => {
      const { data, error } = await useAsyncData(
        `episode-page:${path}`,
        () =>
          loadEpisodePage(
            {
              show: () => $fetch('/api/show'),
              list: () => $fetch('/api/episodes'),
              detail: (savedSlug) => $fetch(`/api/episodes/${savedSlug}`),
            },
            slug,
          ),
        { deep: false },
      )
      if (error.value) throw error.value
      return data.value!
    }),
  )
  nuxt.$router.afterEach((to, _from, failure) =>
    navigation.complete(to.path, Boolean(failure)),
  )
  return { provide: { episodeNavigation: navigation } }
})
