<script setup lang="ts">
import type { PodcastPlayer } from '../composables/usePodcastPlayer'
import { formatTime } from '../services/episode-page'
const props = defineProps<{ player: PodcastPlayer; sourceUrl?: string }>()
const state = computed(() => props.player.state)
const draft = ref<number | null>(null)
const showPause = computed(
  () => state.value.wantsPlay || state.value.continuing,
)
const time = computed(() => draft.value ?? state.value.currentTime)
const seekable = computed(
  () =>
    state.value.duration !== null &&
    !state.value.restoring &&
    state.value.status !== 'error',
)
const available = computed(
  () =>
    Boolean(state.value.sourceId) &&
    !state.value.restoring &&
    state.value.status !== 'error',
)
function spoken(seconds: number) {
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const tail = whole % 60
  return [
    [hours, 'hour'],
    [minutes, 'minute'],
    [tail, 'second'],
  ]
    .filter(([value, unit]) => value || unit === 'second')
    .map(([value, unit]) => `${value} ${unit}${value === 1 ? '' : 's'}`)
    .join(', ')
}
const seekDescription = computed(() =>
  state.value.duration === null
    ? 'Duration unavailable'
    : `${spoken(time.value)} of ${spoken(state.value.duration)}`,
)
function preview(event: Event) {
  draft.value = Number((event.target as HTMLInputElement).value)
}
function commit() {
  if (draft.value === null) return
  const target = draft.value
  draft.value = null
  props.player.seek(target)
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    draft.value = null
    return
  }
  if (!seekable.value) return
  const current = Math.min(
    state.value.duration!,
    state.value.pendingSeek ?? state.value.currentTime,
  )
  const targets: Record<string, number> = {
    ArrowLeft: current - 5,
    ArrowDown: current - 5,
    ArrowRight: current + 5,
    ArrowUp: current + 5,
    PageDown: current - 30,
    PageUp: current + 30,
    Home: 0,
    End: state.value.duration!,
  }
  const target = targets[event.key]
  if (target === undefined) return
  event.preventDefault()
  draft.value = null
  props.player.seek(Math.min(state.value.duration!, Math.max(0, target)))
}
watch(
  [
    () => state.value.sourceId,
    () => props.sourceUrl,
    () => state.value.status === 'error' || state.value.status === 'ended',
  ],
  () => {
    draft.value = null
  },
)
</script>

<template>
  <div
    class="audio-controls"
    role="group"
    aria-label="Audio player"
    aria-describedby="playback-status"
  >
    <div class="seek-row">
      <span class="player-time" aria-hidden="true">{{ formatTime(time) }}</span>
      <input
        aria-label="Playback position"
        type="range"
        min="0"
        :max="state.duration ?? 0"
        step="any"
        :value="time"
        :aria-valuetext="seekDescription"
        :disabled="!seekable"
        @input="preview"
        @change="commit"
        @keydown="key"
        @pointercancel="draft = null"
        @blur="draft = null"
      />
      <span class="player-time" aria-hidden="true">{{
        state.duration === null ? '—:—' : formatTime(state.duration)
      }}</span>
    </div>
    <div class="transport-row">
      <button
        type="button"
        aria-label="Previous track"
        :disabled="!available || player.tracks.previous === null"
        @click="player.previousTrack()"
      >
        Previous track
      </button>
      <button
        type="button"
        aria-label="Back 30 seconds"
        :disabled="!seekable || (state.pendingSeek ?? state.currentTime) <= 0"
        @click="player.skip(-30)"
      >
        −30<span class="seconds-label">s</span>
      </button>
      <button
        class="play-toggle"
        type="button"
        :aria-label="showPause ? 'Pause' : 'Play'"
        :disabled="!available"
        @click="showPause ? player.pause() : player.play()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path v-if="showPause" d="M6 4h4v16H6zm8 0h4v16h-4z" />
          <path v-else d="m7 3 15 9-15 9z" />
        </svg>
        <span>{{ showPause ? 'Pause' : 'Play' }}</span>
      </button>
      <button
        type="button"
        aria-label="Forward 30 seconds"
        :disabled="
          !seekable ||
          (state.pendingSeek ?? state.currentTime) >= (state.duration ?? 0)
        "
        @click="player.skip(30)"
      >
        +30<span class="seconds-label">s</span>
      </button>
      <button
        type="button"
        aria-label="Next track"
        :disabled="!available || player.tracks.next === null"
        @click="player.nextTrack()"
      >
        Next track
      </button>
    </div>
    <div
      class="episode-controls"
      role="group"
      aria-label="Episode navigation"
      :aria-busy="player.sequencing.busy"
    >
      <button
        type="button"
        :disabled="
          state.restoring ||
          !state.sourceId ||
          !player.sequencing.available ||
          player.sequencing.busy
        "
        @click="player.olderEpisode()"
      >
        Older episode
      </button>
      <button
        type="button"
        :disabled="
          state.restoring ||
          !state.sourceId ||
          !player.sequencing.available ||
          player.sequencing.busy
        "
        @click="player.newerEpisode()"
      >
        Newer episode
      </button>
      <label
        >Automatic playback order
        <select
          :value="player.sequencing.order"
          :disabled="!player.sequencing.available"
          @change="
            player.setOrder(
              ($event.target as HTMLSelectElement).value as 'older' | 'newer',
            )
          "
        >
          <option value="older">Newer to older</option>
          <option value="newer">Older to newer</option>
        </select>
      </label>
    </div>
    <div class="volume-row">
      <button
        v-if="state.muteSupported"
        type="button"
        :aria-label="state.muted || state.volume === 0 ? 'Unmute' : 'Mute'"
        :disabled="!available"
        @click="player.toggleMute()"
      >
        {{ state.muted || state.volume === 0 ? 'Unmute' : 'Mute' }}
      </button>
      <label v-if="state.volumeSupported" class="volume-control">
        <span>Volume</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="state.volume"
          :aria-valuetext="`${Math.round(state.volume * 100)} percent`"
          :disabled="!available"
          @input="
            player.setVolume(Number(($event.target as HTMLInputElement).value))
          "
        />
        <span class="volume-value" aria-hidden="true"
          >{{ Math.round(state.volume * 100) }}%</span
        >
      </label>
      <p v-else class="device-volume">Use your device's volume buttons.</p>
    </div>
  </div>
</template>
