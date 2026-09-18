<script setup lang="ts">
import LinkIcon from './LinkIcon.vue'
import { timestampSeconds, timestampUrl } from '../services/timestamp-link'
const props = defineProps<{
  episodePath: string
  seconds: number
  label: string
  disabled?: boolean
}>()
const emit = defineEmits<{
  copy: [request: { url: string; target: HTMLElement }]
}>()
function copy(event: MouseEvent) {
  if (props.disabled) return
  const url = timestampUrl(
    window.location.origin,
    props.episodePath,
    props.seconds,
  )
  if (!url) return
  emit('copy', {
    url,
    target: event.currentTarget as HTMLElement,
  })
}
</script>

<template>
  <button
    class="timestamp-copy"
    type="button"
    :aria-label="label"
    :title="label"
    :disabled="disabled || timestampSeconds(seconds) === null"
    @click="copy"
  >
    <LinkIcon />
  </button>
</template>
