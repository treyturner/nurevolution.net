<script setup lang="ts">
import type { EpisodeDetail } from '../../shared/content/public'
import { formatDate, formatTime } from '../services/episode-page'
import { usePodcastPlayer } from '../composables/usePodcastPlayer'
import { deliveryAssetUrl } from '../services/delivery-assets'
import DownloadIcon from './DownloadIcon.vue'
import ArtworkDialog from './ArtworkDialog.vue'
const props = defineProps<{ episode: EpisodeDetail | null }>()
const config = useRuntimeConfig()
const artworkUrl = computed(() =>
  props.episode
    ? deliveryAssetUrl(
        props.episode.artworkUrl,
        'artwork',
        config.public.webOrigin,
      )
    : '',
)
const { element, status, retry } = usePodcastPlayer(() => props.episode)
const failedArtwork = ref(false)
const artworkOpen = ref(false)
const artworkTrigger = ref<HTMLButtonElement | null>(null)
function closeArtwork() {
  artworkOpen.value = false
  artworkTrigger.value?.focus({ preventScroll: true })
}
watch(artworkUrl, () => {
  failedArtwork.value = false
})
watch([artworkUrl, () => props.episode?.id], () => {
  artworkOpen.value = false
})
const messages = {
  idle: 'Choose an episode to listen.',
  loading: 'Loading audio…',
  delayed: 'Audio is taking longer to load.',
  paused: 'Press Play to listen.',
  playing: 'Playing',
  buffering: 'Buffering…',
  ended: 'Episode finished.',
  error: 'Audio could not be loaded. Please try again.',
  blocked: 'Press Play to continue.',
}
</script>

<template>
  <section class="player" aria-labelledby="episode-title">
    <div v-if="episode" class="artwork">
      <button
        v-if="!failedArtwork"
        ref="artworkTrigger"
        type="button"
        class="artwork-trigger"
        aria-haspopup="dialog"
        :aria-label="`Enlarge ${episode.artist} — ${episode.title} cover art`"
        @click="artworkOpen = true"
      >
        <img
          :src="artworkUrl"
          :alt="`${episode.artist} — ${episode.title} cover art`"
          width="480"
          height="480"
          @error="failedArtwork = true"
        />
      </button>
      <div
        v-else
        class="artwork-fallback"
        role="img"
        :aria-label="`Cover art unavailable for ${episode.title}`"
      >
        <span aria-hidden="true">N / R</span><span>Artwork unavailable</span>
      </div>
    </div>
    <div class="player-content">
      <p v-if="episode" class="episode-artist">{{ episode.artist }}</p>
      <h1 id="episode-title">{{ episode?.title ?? 'Podcast archive' }}</h1>
      <p v-if="episode" class="episode-meta">
        <time :datetime="episode.publishedAt ?? undefined">{{
          formatDate(episode.publishedAt)
        }}</time
        ><span aria-hidden="true"> / </span
        >{{ formatTime(episode.durationSeconds) }}
      </p>
      <p v-else>No episodes are available yet.</p>
      <audio
        ref="element"
        controls
        controlslist="nodownload noplaybackrate"
        preload="metadata"
        aria-describedby="playback-status"
        :aria-label="
          episode
            ? `Listen to ${episode.artist} — ${episode.title}`
            : 'Episode audio'
        "
      />
      <div class="player-actions">
        <p id="playback-status" class="media-status">{{ messages[status] }}</p>
        <button
          v-if="status === 'error' || status === 'delayed'"
          type="button"
          @click="retry"
        >
          Retry audio
        </button>
        <a
          v-if="episode"
          class="download-link"
          :href="`/downloads/${episode.slug}`"
          :download="episode.audio.downloadFilename"
          >Download MP3 <DownloadIcon
        /></a>
      </div>
      <!-- The server validates and sanitizes canonical descriptions before this projection. -->
      <!-- eslint-disable vue/no-v-html -->
      <div
        v-if="episode"
        class="description"
        v-html="episode.descriptionHtml"
      />
      <!-- eslint-enable vue/no-v-html -->
    </div>
    <ArtworkDialog
      v-if="artworkOpen && episode && !failedArtwork"
      :src="artworkUrl"
      :alt="`${episode.artist} — ${episode.title} cover art`"
      @close="closeArtwork"
    />
  </section>
</template>
