<script setup lang="ts">
import type { EpisodeSummary } from '../../shared/content/public'
import { formatDate } from '../services/episode-page'
import { useCopyLink } from '../composables/useCopyLink'
import DownloadIcon from './DownloadIcon.vue'
import LinkIcon from './LinkIcon.vue'
import CopyLinkToast from './CopyLinkToast.vue'
const props = defineProps<{
  episodes: EpisodeSummary[]
  siteUrl: string
  selectedId?: string
  pendingPath?: string | null
}>()
const { toast, copyLink } = useCopyLink()
function copyEpisodeLink(episode: EpisodeSummary, event: MouseEvent) {
  void copyLink({
    url: new URL(episode.path, props.siteUrl).href,
    target: event.currentTarget as HTMLElement,
    message: 'Episode link copied',
    androidInlineId: episode.id,
  })
}
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
      <button
        type="button"
        class="row-copy-link"
        :title="
          toast?.inlineId === episode.id ? 'Link copied' : 'Copy episode link'
        "
        :aria-label="`Copy link to ${episode.artist} - ${episode.title}`"
        @click="copyEpisodeLink(episode, $event)"
      >
        <svg
          v-if="toast?.inlineId === episode.id"
          class="copy-link-confirmation"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m5 12 4 4L19 6" />
        </svg>
        <LinkIcon v-else />
      </button>
      <a
        class="row-download"
        :href="`/downloads/${episode.slug}`"
        download
        title="Download MP3"
        :aria-label="`Download ${episode.artist} - ${episode.title}`"
        ><DownloadIcon
      /></a>
    </li>
  </ol>
  <span class="sr-only" role="status" aria-atomic="true">{{
    toast?.message
  }}</span>
  <CopyLinkToast
    v-if="toast && !toast.inlineId"
    :target="toast.target"
    :message="toast.message"
  />
</template>
