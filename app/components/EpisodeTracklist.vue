<script setup lang="ts">
import type { EpisodeDetail } from '../../shared/content/public'
import type { PodcastPlayer } from '../composables/usePodcastPlayer'
import { formatTime } from '../services/episode-page'
const props = defineProps<{
  tracks: EpisodeDetail['tracks']
  player?: PodcastPlayer
}>()
const playing = computed(() => props.player?.state.status === 'playing')
const timed = (position: number) =>
  props.player?.tracks.positions.includes(position) ?? false
</script>

<template>
  <ol v-if="tracks.length" class="track-list">
    <li
      v-for="track in tracks"
      :key="track.position"
      :aria-current="
        player?.tracks.current === track.position ? 'true' : undefined
      "
    >
      <component
        :is="timed(track.position) ? 'button' : 'div'"
        class="track-row"
        :type="timed(track.position) ? 'button' : undefined"
        :aria-label="
          timed(track.position)
            ? `Seek to track ${track.position}: ${track.artist} — ${track.title}, ${formatTime(track.startTime)}`
            : undefined
        "
        :disabled="
          timed(track.position)
            ? !player?.state.attached ||
              player.state.restoring ||
              player.state.status === 'error'
            : undefined
        "
        @click="timed(track.position) && player?.seekTrack(track.position)"
      >
        <span class="track-number" aria-hidden="true">{{
          String(track.position).padStart(2, '0')
        }}</span>
        <span>
          <span class="track-artist">{{ track.artist }}</span
          ><span class="track-title">{{ track.title }}</span>
        </span>
        <span v-if="track.startTime !== null" class="track-meta">
          <span
            v-if="player?.tracks.current === track.position"
            class="track-current"
          >
            <span>{{ playing ? 'now playing' : 'selected' }}</span>
            <svg
              class="track-equalizer"
              :class="{ 'is-playing': playing }"
              viewBox="0 0 18 16"
              aria-hidden="true"
              focusable="false"
            >
              <rect x="0" y="8" width="2" height="8" rx="0.5" />
              <rect x="4" y="3" width="2" height="13" rx="0.5" />
              <rect x="8" y="0" width="2" height="16" rx="0.5" />
              <rect x="12" y="5" width="2" height="11" rx="0.5" />
              <rect x="16" y="9" width="2" height="7" rx="0.5" />
            </svg>
          </span>
          <span class="track-start">{{ formatTime(track.startTime) }}</span>
        </span>
      </component>
    </li>
  </ol>
  <p v-else class="empty-tracks">No tracklist is available for this episode.</p>
</template>
