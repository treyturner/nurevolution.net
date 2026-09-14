<script setup lang="ts">
import type { EpisodeSummary } from '../../shared/content/public'
defineProps<{ episode: EpisodeSummary }>()
const emit = defineEmits<{ answer: [allowed: boolean] }>()
const dialog = ref<HTMLDialogElement | null>(null)
onMounted(() => dialog.value!.showModal())
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog
    ref="dialog"
    class="episode-change-dialog"
    aria-labelledby="episode-change-question"
    aria-describedby="episode-change-target"
    @cancel.prevent="emit('answer', false)"
    @click.self="emit('answer', false)"
  >
    <h2 id="episode-change-question">Stop playback to change episodes?</h2>
    <p id="episode-change-target">{{ episode.artist }} — {{ episode.title }}</p>
    <div class="episode-change-actions">
      <button type="button" autofocus @click="emit('answer', false)">
        Keep listening
      </button>
      <button type="button" @click="emit('answer', true)">
        Change episode
      </button>
    </div>
  </dialog>
</template>
