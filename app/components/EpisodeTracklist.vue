<script setup lang="ts">
import type { EpisodeDetail } from '../../shared/content/public'
import type { PodcastPlayer } from '../composables/usePodcastPlayer'
import { formatTime } from '../services/episode-page'
const props = defineProps<{
  tracks: EpisodeDetail['tracks']
  player?: PodcastPlayer
}>()
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
          <span
            v-if="player?.tracks.current === track.position"
            class="track-current"
            >Current position</span
          >
        </span>
        <span v-if="track.startTime !== null" class="track-start">{{
          formatTime(track.startTime)
        }}</span>
      </component>
    </li>
  </ol>
  <p v-else class="empty-tracks">No tracklist is available for this episode.</p>
</template>
