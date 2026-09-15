<script setup lang="ts">
import { useCopyLink } from '../composables/useCopyLink'

const props = defineProps<{ feedUrl: string }>()
const { toast, copyLink } = useCopyLink()
function copyFeed(event: MouseEvent) {
  void copyLink({
    url: props.feedUrl,
    target: event.currentTarget as HTMLElement,
    message: 'RSS URL copied',
  })
}
</script>

<template>
  <button
    type="button"
    class="rss-link"
    aria-label="Copy RSS URL"
    title="Copy RSS URL"
    @click="copyFeed"
  >
    <span class="rss-label">Subscribe<br />via RSS</span>
    <RssIcon class="rss-icon" />
  </button>
  <span class="sr-only" role="status" aria-atomic="true">{{
    toast?.message
  }}</span>
  <CopyLinkToast v-if="toast" :target="toast.target" :message="toast.message" />
</template>
