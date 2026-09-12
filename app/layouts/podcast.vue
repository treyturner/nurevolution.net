<script setup lang="ts">
import { episodeHead } from '../services/episode-page'
const state = useEpisodePage()
const currentYear = useState('copyright-year', () =>
  new Date().getUTCFullYear(),
)
const announcement = ref('')
watch(
  () => state.value.model?.selected?.id,
  () => {
    const episode = state.value.model?.selected
    announcement.value = episode
      ? `Selected ${episode.artist} — ${episode.title}`
      : 'No episodes are available.'
  },
)
useHead(() =>
  state.value.model ? episodeHead(state.value.model, state.value.path) : {},
)
</script>

<template>
  <div v-if="state.model" class="podcast">
    <header class="site-header">
      <NuxtLink to="/" :prefetch="false" class="wordmark"
        >Nurevolution<span>Independent transmissions</span></NuxtLink
      >
      <a :href="state.model.show.feedUrl"
        >Subscribe via RSS <span aria-hidden="true">↗</span></a
      >
    </header>
    <p v-if="state.failedPath" class="navigation-error" role="alert">
      Could not load this episode.
      <NuxtLink :to="state.failedPath" :prefetch="false">Try again</NuxtLink>
    </p>
    <p class="sr-only" role="status">{{ announcement }}</p>
    <ArchivePlayer :episode="state.model.selected" />
    <ArchiveLists
      :episodes="state.model.episodes"
      :selected="state.model.selected"
      :pending-path="state.pendingPath"
    />
    <footer class="site-footer">© {{ currentYear }} nurevolution.net</footer>
    <slot />
  </div>
</template>
