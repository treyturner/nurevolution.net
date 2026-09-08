<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createAudioAdapter } from '../../../../../app/services/audio'

const element = ref<HTMLAudioElement | null>(null)
const status = ref('Loading')
const position = ref(0)
const failure = ref('')
let adapter: ReturnType<typeof createAudioAdapter> | undefined

onMounted(() => {
  adapter = createAudioAdapter(element.value!)
  adapter.subscribe('loadedmetadata', () => (status.value = 'Ready'))
  adapter.subscribe('play', () => (status.value = 'Playing'))
  adapter.subscribe('pause', () => (status.value = 'Paused'))
  adapter.subscribe('ended', () => (status.value = 'Ended'))
  adapter.subscribe('error', () => (failure.value = 'Unable to load audio'))
  adapter.load('/sample.wav')
})

onBeforeUnmount(() => adapter?.dispose())

async function play() {
  try {
    await adapter!.play()
  } catch {
    failure.value = 'Playback failed'
  }
}

function dispose() {
  adapter!.dispose()
  status.value = 'Disposed'
}

function updatePosition() {
  position.value = element.value!.currentTime
}
</script>

<template>
  <main>
    <h1>Audio fixture</h1>
    <audio
      ref="element"
      preload="metadata"
      muted
      @timeupdate="updatePosition"
    />
    <p role="status" aria-label="Playback state">{{ status }}</p>
    <output aria-label="Playback position">{{ position }}</output>
    <p v-if="failure" role="alert">{{ failure }}</p>
    <button
      :disabled="status === 'Loading' || status === 'Disposed'"
      @click="play"
    >
      Play
    </button>
    <button :disabled="status !== 'Playing'" @click="adapter!.pause()">
      Pause
    </button>
    <button
      :disabled="status === 'Loading' || status === 'Disposed'"
      @click="dispose"
    >
      Dispose player
    </button>
  </main>
</template>

<style>
body {
  font:
    1rem/1.5 system-ui,
    sans-serif;
}
button {
  margin: 0.5rem;
  padding: 0.5rem 1rem;
  font: inherit;
}
:focus-visible {
  outline: 3px solid #0055cc;
  outline-offset: 3px;
}
</style>
