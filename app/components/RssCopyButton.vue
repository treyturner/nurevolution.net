<script setup lang="ts">
import { useCopyLink } from '../composables/useCopyLink'

const props = defineProps<{ feedUrl: string }>()
const { toast, copyLink } = useCopyLink()
const openFeed = ref(false)
async function copyFeed(event: MouseEvent) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    openFeed.value ||
    !navigator.clipboard?.writeText
  )
    return
  event.preventDefault()
  const copied = await copyLink({
    url: props.feedUrl,
    target: event.currentTarget as HTMLElement,
    message: 'RSS URL copied',
    errorMessage:
      'Couldn’t copy RSS URL. Click again to open the feed in a new tab.',
  })
  if (copied === false) openFeed.value = true
}
</script>

<template>
  <a
    :href="feedUrl"
    target="_blank"
    rel="noopener noreferrer"
    class="rss-link"
    :aria-label="
      openFeed
        ? 'Subscribe via RSS (opens in a new tab)'
        : 'Subscribe via RSS (copy RSS URL)'
    "
    :title="openFeed ? 'Open RSS feed in a new tab' : 'Copy RSS URL'"
    @click="copyFeed"
  >
    <span class="rss-label">Subscribe<br />via RSS</span>
    <RssIcon class="rss-icon" />
  </a>
  <span class="sr-only" role="status" aria-atomic="true">{{
    toast?.message
  }}</span>
  <CopyLinkToast v-if="toast" :target="toast.target" :message="toast.message" />
</template>
