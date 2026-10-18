<script setup lang="ts">
import type { EpisodeSummary } from '../../shared/content/public'
import type { PodcastPlayer } from '../composables/usePodcastPlayer'
import { formatDate } from '../services/episode-page'
import DownloadIcon from './DownloadIcon.vue'
import ExplicitTitle from './ExplicitTitle.vue'
const props = defineProps<{
  player?: PodcastPlayer
  episodes: EpisodeSummary[]
  selectedId?: string
  pendingPath?: string | null
}>()
const canPlay = computed(() =>
  Boolean(
    props.player?.state.initialized &&
    !props.player.state.restoring &&
    !props.player.sequencing.busy,
  ),
)
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
          <span class="episode-list-title"
            ><span class="episode-list-title-text"
              ><ExplicitTitle
                :title="episode.title"
                :explicit="episode.explicit" /></span
          ></span>
          <span class="episode-list-artist">
            <span class="episode-list-meta">
              <span class="episode-list-artist-name"
                ><template
                  v-for="(part, index) in episode.artist.split(/\s+(?=&)/)"
                  :key="index"
                  >{{ index ? ' ' : ''
                  }}<span class="episode-list-artist-part">{{
                    part
                  }}</span></template
                ></span
              >
              <time
                v-if="episode.publishedAt"
                class="episode-list-date"
                :datetime="episode.publishedAt"
              >
                <span class="episode-date-separator" aria-hidden="true">·</span
                >{{ formatDate(episode.publishedAt) }}
              </time>
            </span>
          </span>
        </span>
      </NuxtLink>
      <span class="episode-row-actions">
        <button
          v-if="player"
          type="button"
          class="row-play"
          title="Play episode"
          :aria-label="`Play ${episode.artist} - ${episode.title}`"
          :aria-disabled="!canPlay"
          @click="canPlay && player.playEpisode(episode.id)"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M7 4v16l14-8z" />
          </svg>
        </button>
        <a
          class="row-download"
          :href="`/downloads/${episode.slug}`"
          download
          title="Download MP3"
          :aria-label="`Download ${episode.artist} - ${episode.title}`"
          ><DownloadIcon
        /></a>
      </span>
    </li>
  </ol>
</template>
