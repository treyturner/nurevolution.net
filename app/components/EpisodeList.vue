<script setup lang="ts">
import type { EpisodeSummary } from '../../shared/content/public'
import { formatDate } from '../services/episode-page'
import DownloadIcon from './DownloadIcon.vue'
import LinkIcon from './LinkIcon.vue'
import CopyLinkToast from './CopyLinkToast.vue'
const props = defineProps<{
  episodes: EpisodeSummary[]
  siteUrl: string
  selectedId?: string
  pendingPath?: string | null
}>()
const toast = shallowRef<{ target: HTMLElement; message: string } | null>(null)
let sequence = 0
let timer: ReturnType<typeof setTimeout> | undefined
async function copyLink(episode: EpisodeSummary, event: MouseEvent) {
  const target = event.currentTarget as HTMLElement
  const own = ++sequence
  clearTimeout(timer)
  toast.value = null
  let message = 'Episode link copied'
  try {
    await navigator.clipboard.writeText(
      new URL(episode.path, props.siteUrl).href,
    )
  } catch {
    message = 'Couldn’t copy link. Please try again.'
  }
  if (own !== sequence) return
  toast.value = { target, message }
  timer = setTimeout(() => {
    toast.value = null
  }, 3000)
}
onBeforeUnmount(() => {
  sequence++
  clearTimeout(timer)
})
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
        ><span class="episode-list-artist"
          >{{ episode.artist
          }}<template v-if="episode.publishedAt"
            ><span aria-hidden="true"> · </span
            ><time :datetime="episode.publishedAt">{{
              formatDate(episode.publishedAt)
            }}</time></template
          ></span
        >
      </NuxtLink>
      <button
        type="button"
        class="row-copy-link"
        title="Copy episode link"
        :aria-label="`Copy link to ${episode.artist} — ${episode.title}`"
        @click="copyLink(episode, $event)"
      >
        <LinkIcon />
      </button>
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
  <span class="sr-only" role="status" aria-atomic="true">{{
    toast?.message
  }}</span>
  <CopyLinkToast v-if="toast" :target="toast.target" :message="toast.message" />
</template>
