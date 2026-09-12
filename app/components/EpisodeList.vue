<script setup lang="ts">
import type { EpisodeSummary } from '../../shared/content/public'
import { formatDate } from '../services/episode-page'
import DownloadIcon from './DownloadIcon.vue'
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
        <img
          class="episode-list-artwork"
          :src="episode.artworkThumbnailUrl"
          alt=""
          width="48"
          height="48"
          loading="lazy"
          decoding="async"
        />
        <span class="episode-list-info">
          <span class="episode-list-title">{{ episode.title }}</span
          ><span class="episode-list-artist"
            >{{ episode.artist
            }}<template v-if="episode.publishedAt"
              ><span aria-hidden="true"> · </span
              ><time :datetime="episode.publishedAt">{{
                formatDate(episode.publishedAt)
              }}</time></template
            ></span
          >
        </span>
      </NuxtLink>
      <a
        class="row-download"
        :href="`/downloads/${episode.slug}`"
        download
        title="Download MP3"
        :aria-label="`Download ${episode.artist} — ${episode.title}`"
        ><DownloadIcon
      /></a>
    </li>
  </ol>
</template>
