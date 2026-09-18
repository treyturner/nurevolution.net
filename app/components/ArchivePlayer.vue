<script setup lang="ts">
import type { EpisodeDetail } from '../../shared/content/public'
import { formatDate, formatTime } from '../services/episode-page'
import type { PodcastPlayer } from '../composables/usePodcastPlayer'
import { deliveryAssetUrl } from '../services/delivery-assets'
import DownloadIcon from './DownloadIcon.vue'
import ArtworkDialog from './ArtworkDialog.vue'
import PlayerControls from './PlayerControls.vue'
const props = defineProps<{
  episode: EpisodeDetail | null
  player: PodcastPlayer
  failedPath?: string | null
}>()
const config = useRuntimeConfig()
useHead({
  noscript: [
    { innerHTML: '<style>.player-startup-loading{display:none}</style>' },
  ],
})
const artworkUrl = computed(() =>
  props.episode
    ? deliveryAssetUrl(
        props.episode.artworkUrl,
        'artwork',
        config.public.webOrigin,
      )
    : '',
)
// Canonical HTML is sanitized to anchors with only href/title attributes.
const descriptionHtml = computed(() =>
  (props.episode?.descriptionHtml ?? '').replace(
    /<a(?=[\s>])/g,
    '<a target="_blank" rel="noopener noreferrer"',
  ),
)
const status = computed(() => props.player.state.status)
const retry = () => props.player.retry()
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
  error: 'Audio could not be loaded.',
  blocked: 'Press Play to continue.',
}
const statusMessage = computed(() => {
  if (props.player.state.restoring) return 'Restoring your place…'
  if (props.episode && !props.player.state.initialized) return 'Loading player…'
  if (status.value === 'playing') {
    const tracks = props.episode?.tracks ?? []
    const current = tracks.find(
      (track) => track.position === props.player.tracks.current,
    )
    if (current)
      return `Playing ${current.position}/${tracks.length}: ${current.artist} - ${current.title}`
  }
  return messages[status.value]
})
const feedback = computed(() => {
  if (props.failedPath || props.player.sequencing.failed)
    return {
      message:
        props.player.state.restoreMessage || 'Episode could not be loaded.',
      error: true,
      retry: props.failedPath ? 'episode' : null,
    }
  if (status.value === 'error')
    return { message: messages.error, error: true, retry: 'audio' }
  const message =
    props.player.state.restoreMessage || props.player.state.seekMessage
  if (message) return { message, error: true, retry: null }
  return {
    message: statusMessage.value,
    error: false,
    retry: status.value === 'delayed' ? 'audio' : null,
  }
})
</script>

<template>
  <section
    class="player"
    aria-labelledby="episode-title"
    :data-player-startup="
      episode && !player.state.initialized ? 'pending' : undefined
    "
  >
    <div v-if="episode" class="artwork">
      <button
        v-if="!failedArtwork"
        ref="artworkTrigger"
        type="button"
        class="artwork-trigger"
        aria-haspopup="dialog"
        :aria-label="`Enlarge ${episode.artist} - ${episode.title} cover art`"
        @click="artworkOpen = true"
      >
        <img
          :src="artworkUrl"
          :alt="`${episode.artist} - ${episode.title} cover art`"
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
        :ref="player.bindAudio"
        :controls="!player.state.attached"
        :class="{ 'custom-audio': player.state.attached }"
        controlslist="nodownload noplaybackrate"
        preload="metadata"
        aria-describedby="playback-status"
        :aria-label="
          episode
            ? `Listen to ${episode.artist} - ${episode.title}`
            : 'Episode audio'
        "
      />
      <PlayerControls
        v-if="player.state.attached"
        :player="player"
        :source-url="episode?.audio.url"
      />
      <div class="player-actions">
        <div
          class="player-feedback"
          :class="{ 'player-feedback-error': feedback.error }"
        >
          <p
            id="playback-status"
            class="media-status"
            role="status"
            aria-atomic="true"
          >
            <span
              :class="{
                'player-startup-loading': episode && !player.state.initialized,
              }"
              >{{ feedback.message }}</span
            >
            <template v-if="episode && !player.state.initialized">
              <span class="player-startup-failure"
                >Player could not start.</span
              >
              <noscript
                >JavaScript is needed for playback. You can download the
                MP3.</noscript
              >
            </template>
          </p>
          <span class="player-status-action">
            <a
              v-if="episode && !player.state.initialized"
              class="status-retry player-startup-reload"
              href=""
              >Reload</a
            >
            <NuxtLink
              v-else-if="feedback.retry === 'episode'"
              class="status-retry"
              :to="failedPath!"
              :prefetch="false"
              aria-label="Retry episode"
              >Retry</NuxtLink
            >
            <button
              v-else-if="feedback.retry === 'audio'"
              class="status-retry"
              type="button"
              aria-label="Retry audio"
              @click="retry"
            >
              Retry
            </button>
          </span>
        </div>
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
      <div v-if="episode" class="description" v-html="descriptionHtml" />
      <!-- eslint-enable vue/no-v-html -->
    </div>
    <ArtworkDialog
      v-if="artworkOpen && episode && !failedArtwork"
      :src="artworkUrl"
      :alt="`${episode.artist} - ${episode.title} cover art`"
      @close="closeArtwork"
    />
  </section>
</template>
