<script setup lang="ts">
import type { EpisodeDetail } from '../../shared/content/public'
import { formatTime } from '../services/episode-page'
defineProps<{ tracks: EpisodeDetail['tracks'] }>()
</script>

<template>
  <ol v-if="tracks.length" class="track-list">
    <li v-for="track in tracks" :key="track.position">
      <span class="track-number" aria-hidden="true">{{
        String(track.position).padStart(2, '0')
      }}</span>
      <div>
        <span class="track-artist">{{ track.artist }}</span
        ><span class="track-title">{{ track.title }}</span>
      </div>
      <span v-if="track.startTime !== null" class="track-start">{{
        formatTime(track.startTime)
      }}</span>
    </li>
  </ol>
  <p v-else class="empty-tracks">No tracklist is available for this episode.</p>
</template>
