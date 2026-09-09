<script setup lang="ts">
import type { EpisodeDetail } from '../../shared/content/public'
import { formatDate, formatTime } from '../services/episode-page'
import { usePodcastPlayer } from '../composables/usePodcastPlayer'
const props = defineProps<{ episode: EpisodeDetail | null }>()
const { element, status, retry } = usePodcastPlayer(() => props.episode)
const failedArtwork = ref(false)
watch(
  () => props.episode?.artworkUrl,
  () => {
    failedArtwork.value = false
  },
)
const messages = {
  idle: 'Choose an episode to listen.',
  loading: 'Loading audio…',
  paused: 'Ready when you are.',
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
      <img
        v-if="!failedArtwork"
        :src="episode.artworkUrl"
        :alt="`${episode.artist} — ${episode.title} cover art`"
        width="480"
        height="480"
        @error="failedArtwork = true"
      />
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
      <p class="eyebrow">{{ episode ? 'From the archive' : 'Nurevolution' }}</p>
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
        preload="metadata"
        :aria-label="
          episode
            ? `Listen to ${episode.artist} — ${episode.title}`
            : 'Episode audio'
        "
      />
      <div class="player-actions">
        <p class="media-status" role="status">{{ messages[status] }}</p>
        <button v-if="status === 'error'" type="button" @click="retry">
          Retry audio
        </button>
        <a
          v-if="episode"
          class="download-link"
          :href="`/downloads/${episode.slug}`"
          :download="episode.audio.downloadFilename"
          >Download MP3 <span aria-hidden="true">↓</span></a
        >
      </div>
      <!-- The server validates and sanitizes canonical descriptions before this projection. -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div
        v-if="episode"
        class="description"
        v-html="episode.descriptionHtml"
      />
    </div>
  </section>
</template>
