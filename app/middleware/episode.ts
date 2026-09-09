export default defineNuxtRouteMiddleware(async (to) => {
  const nuxt = useNuxtApp()
  const state = useEpisodePage()
  if (nuxt.isHydrating && state.value.model && state.value.path === to.path)
    return
  const slug = typeof to.params.slug === 'string' ? to.params.slug : undefined
  try {
    const accepted = await nuxt.$episodeNavigation.prepare(to.path, slug)
    if (!accepted) return abortNavigation()
    to.meta.episodeNavigationToken = accepted
    if (import.meta.server) nuxt.$episodeNavigation.complete(to.path, accepted)
  } catch (error) {
    if (state.value.model) return abortNavigation()
    throw createError({
      statusCode:
        (error as { statusCode?: number }).statusCode === 404 ? 404 : 503,
      statusMessage:
        (error as { statusCode?: number }).statusCode === 404
          ? 'Episode not found'
          : 'Archive temporarily unavailable',
    })
  }
})
