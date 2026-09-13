<script setup lang="ts">
import { episodeHead } from '../services/episode-page'
import RssIcon from '../components/RssIcon.vue'
const state = useEpisodePage()
const navigation = useEpisodePlaybackNavigation()
const player = usePodcastPlayer(
  () => state.value.model?.selected ?? null,
  navigation,
)
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
      <div class="site-brand">
        <img
          class="site-logo"
          src="/brand/nu.png"
          width="300"
          height="300"
          alt=""
        />
        <div class="wordmark">nurevolution studios<span>austin, tx</span></div>
      </div>
      <a href="/feed/podcast" class="rss-link" aria-label="Subscribe via RSS"
        ><span class="rss-label">Subscribe<br />via RSS</span
        ><RssIcon class="rss-icon"
      /></a>
    </header>
    <p v-if="state.failedPath" class="navigation-error" role="alert">
      Could not load this episode.
      <NuxtLink :to="state.failedPath" :prefetch="false">Try again</NuxtLink>
    </p>
    <p id="episode-selection-status" class="sr-only" role="status">
      {{ announcement }}
    </p>
    <ArchivePlayer :episode="state.model.selected" :player="player" />
    <ArchiveLists
      :player="player"
      :episodes="state.model.episodes"
      :site-url="state.model.show.siteUrl"
      :selected="state.model.selected"
      :pending-path="state.pendingPath"
    />
    <footer class="site-footer">© {{ currentYear }} nurevolution.net</footer>
    <slot />
  </div>
</template>
