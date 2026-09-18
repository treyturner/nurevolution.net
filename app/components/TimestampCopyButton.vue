<script setup lang="ts">
import LinkIcon from './LinkIcon.vue'
const props = defineProps<{
  url: string | null
  label: string
  text?: string
  disabled?: boolean
}>()
const emit = defineEmits<{
  copy: [request: { url: string; target: HTMLElement }]
}>()
function copy(event: MouseEvent) {
  if (!props.url || props.disabled) return
  emit('copy', {
    url: props.url,
    target: event.currentTarget as HTMLElement,
  })
}
</script>

<template>
  <button
    class="timestamp-copy"
    :class="{ 'timestamp-copy-text': text }"
    type="button"
    :aria-label="label"
    :title="label"
    :disabled="disabled || !url"
    @click="copy"
  >
    <span v-if="text">{{ text }}</span
    ><LinkIcon />
  </button>
</template>
