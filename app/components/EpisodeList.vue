<script setup lang="ts">
import type { EpisodeSummary } from '../../shared/content/public'
defineProps<{
  episodes: EpisodeSummary[]
  selectedId?: string
  pendingPath?: string | null
}>()
</script>

<template>
  <ol class="episode-list">
    <li
      v-for="episode in episodes"
      :key="episode.id"
      :class="{ selected: episode.id === selectedId }"
    >
      <NuxtLink
        :to="episode.path"
        :prefetch="false"
        :aria-current="episode.id === selectedId ? 'page' : undefined"
        :aria-busy="pendingPath === episode.path || undefined"
      >
        <span class="episode-list-title">{{ episode.title }}</span
        ><span class="episode-list-artist">{{ episode.artist }}</span>
      </NuxtLink>
      <a
        class="row-download"
        :href="`/downloads/${episode.slug}`"
        download
        :aria-label="`Download ${episode.artist} — ${episode.title}`"
        ><span aria-hidden="true">↓</span></a
      >
    </li>
  </ol>
</template>
